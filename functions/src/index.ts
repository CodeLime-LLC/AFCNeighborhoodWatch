import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import {
  fetchCsv,
  parseCsv,
  filterByDateAndQuality,
  toSaleRecords,
  dedup,
  getYearsToFetch,
} from "./fetchSales";
import { geocodeAddress, batchGeocode, haversineDistanceMiles } from "./geocode";
import { ChurchConfig, ProcessResult } from "./types";

admin.initializeApp();
const db = admin.firestore();

/**
 * Core pipeline: fetch CSV, parse, geocode, store.
 * Used by both manual trigger and scheduled function.
 */
async function runPipeline(): Promise<ProcessResult> {
  console.log("Pipeline started");

  // 1. Load church config
  const configSnap = await db.doc("config/church").get();
  if (!configSnap.exists) {
    throw new HttpsError("not-found", "Church config not found. Please configure settings first.");
  }
  const config = configSnap.data() as ChurchConfig;
  if (!config.lat || !config.lon) {
    throw new HttpsError("failed-precondition", "Church address not geocoded. Please geocode in settings.");
  }

  // 2. Determine date range and years to fetch
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - config.timeframeMonths);
  const years = getYearsToFetch(config.timeframeMonths);
  console.log(`Fetching years: ${years.join(", ")}, cutoff: ${cutoffDate.toISOString()}`);

  // 3. Fetch and parse CSVs
  let allRows: ReturnType<typeof parseCsv> = [];
  for (const year of years) {
    try {
      console.log(`Fetching CSV for year ${year}...`);
      const csv = await fetchCsv(config.jurisdictionCode, year);
      const rows = parseCsv(csv);
      console.log(`Year ${year}: ${rows.length} rows parsed`);
      allRows = allRows.concat(rows);
    } catch (error) {
      console.warn(`Failed to fetch CSV for year ${year}:`, error);
    }
  }

  // 4. Filter by date and quality
  const filtered = filterByDateAndQuality(allRows, cutoffDate);
  const records = toSaleRecords(filtered, years[0]);
  console.log(`Filtered to ${filtered.length} arm's-length sales, ${records.length} records`);

  // 5. Dedup against existing records
  const existingSnap = await db.collection("sales").select("sourceKey").get();
  const existingKeys = new Set(existingSnap.docs.map((d) => d.data().sourceKey as string));
  const newRecords = dedup(records, existingKeys);
  console.log(`${newRecords.length} new records after dedup (${existingKeys.size} existing)`);

  if (newRecords.length === 0) {
    console.log("No new records to process");
    await db.doc("config/church").update({
      lastFetchDate: admin.firestore.FieldValue.serverTimestamp(),
      lastFetchStatus: "success",
      lastFetchCount: 0,
    });
    return { newRecords: 0, totalInRadius: 0, errors: 0 };
  }

  // 6. Batch geocode new records
  const addressesToGeocode = newRecords.map((r, i) => ({
    id: String(i),
    address: `${r.address}, ${r.city}, IA ${r.zip}`,
  }));

  const geocodeResults = await batchGeocode(addressesToGeocode);
  let errors = 0;

  for (let i = 0; i < newRecords.length; i++) {
    const result = geocodeResults.get(String(i));
    if (result) {
      newRecords[i].lat = result.lat;
      newRecords[i].lon = result.lon;
      newRecords[i].geocodeStatus = "matched";
      newRecords[i].distanceMiles = haversineDistanceMiles(
        config.lat,
        config.lon,
        result.lat,
        result.lon
      );
    } else {
      errors++;
    }
  }
  console.log(`Geocoded: ${geocodeResults.size} matched, ${errors} failed`);

  // 7. Write to Firestore in batches (max 500 per batch)
  const BATCH_SIZE = 500;
  for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = newRecords.slice(i, i + BATCH_SIZE);
    for (const record of chunk) {
      const docRef = db.collection("sales").doc();
      batch.set(docRef, {
        ...record,
        saleDate: admin.firestore.Timestamp.fromDate(record.saleDate),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    console.log(`Wrote batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} records)`);
  }

  // 8. Count total in radius (simple count, no composite index needed)
  let totalInRadius = 0;
  try {
    const recentSalesSnap = await db
      .collection("sales")
      .where("saleDate", ">=", admin.firestore.Timestamp.fromDate(cutoffDate))
      .get();
    totalInRadius = recentSalesSnap.docs.filter(
      (d) => (d.data().distanceMiles ?? Infinity) <= config.radiusMiles
    ).length;
  } catch (err) {
    console.warn("Could not count total in radius:", err);
  }

  // 9. Update config with fetch status
  await db.doc("config/church").update({
    lastFetchDate: admin.firestore.FieldValue.serverTimestamp(),
    lastFetchStatus: "success",
    lastFetchCount: newRecords.length,
  });

  // 10. Log the fetch
  await db.collection("fetchLogs").add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    trigger: "manual",
    totalRecords: allRows.length,
    armsLengthRecords: filtered.length,
    newRecordsAdded: newRecords.length,
    geocodeFailures: errors,
  });

  console.log("Pipeline complete:", {
    newRecords: newRecords.length,
    totalInRadius,
    errors,
  });

  return {
    newRecords: newRecords.length,
    totalInRadius,
    errors,
  };
}

/**
 * Manual trigger — callable from the frontend.
 */
export const processSales = onCall(
  {
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    return runPipeline();
  }
);

/**
 * Geocode a single address — used by the settings page.
 */
export const geocodeAddressFn = onCall(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    const { address } = request.data as { address: string };
    if (!address) {
      throw new HttpsError("invalid-argument", "Address is required.");
    }

    const result = await geocodeAddress(address);
    if (!result) {
      throw new HttpsError("not-found", "Could not geocode address.");
    }

    return result;
  }
);

/**
 * Scheduled monthly run — 1st of each month at 6 AM Central.
 */
export const scheduledProcessSales = onSchedule(
  {
    schedule: "0 6 1 * *",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await runPipeline();
      console.log("Scheduled fetch complete:", result);
    } catch (error) {
      console.error("Scheduled fetch failed:", error);
      await db.doc("config/church").update({
        lastFetchStatus: "error",
      });
    }
  }
);
