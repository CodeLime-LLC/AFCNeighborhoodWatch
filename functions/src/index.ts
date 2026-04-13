import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
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
import { buildReportHtml, buildReportText, sendReportEmail } from "./email";
import { ChurchConfig, ProcessResult } from "./types";

admin.initializeApp();
const db = admin.firestore();

const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");

const CHURCH_LAT = 41.7322;
const CHURCH_LON = -93.6295;

/**
 * Core pipeline: fetch CSV, parse, geocode, store.
 * Used by both manual trigger and scheduled function.
 */
async function runPipeline(): Promise<ProcessResult> {
  console.log("Pipeline started");

  // 1. Load church config
  const configSnap = await db.doc("config/church").get();
  if (!configSnap.exists) {
    throw new HttpsError("not-found", "Church config not found.");
  }
  const config = configSnap.data() as ChurchConfig;

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
        CHURCH_LAT,
        CHURCH_LON,
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

  // 8. Count total in radius
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
  async () => {
    return runPipeline();
  }
);

/**
 * Geocode a single address — used by the settings page.
 */
export const geocodeAddressFn = onCall(
  async (request) => {
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
 * Send a test email — callable from the frontend.
 * Pulls real sales data using the saved email config settings.
 */
export const sendTestEmail = onCall(
  {
    secrets: [SMTP_USER, SMTP_PASS],
    timeoutSeconds: 60,
  },
  async (request) => {
    const { recipientEmail, timeframeMonths, radiusMiles } = request.data as {
      recipientEmail: string;
      timeframeMonths?: number;
      radiusMiles?: number;
    };
    if (!recipientEmail) {
      throw new HttpsError("invalid-argument", "Recipient email is required.");
    }

    const tfMonths = timeframeMonths ?? 1;
    const radius = radiusMiles ?? 3;

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - tfMonths);

    const salesSnap = await db
      .collection("sales")
      .where("saleDate", ">=", admin.firestore.Timestamp.fromDate(cutoffDate))
      .orderBy("saleDate", "desc")
      .get();

    const sales = salesSnap.docs
      .map((d) => d.data())
      .filter(
        (s) => s.distanceMiles != null && s.distanceMiles <= radius
      )
      .map((s) => ({
        buyer: s.buyer as string,
        address: s.address as string,
        city: s.city as string,
        zip: s.zip as string,
        distanceMiles: s.distanceMiles as number,
        saleDate: (s.saleDate as admin.firestore.Timestamp).toDate(),
      }));

    const html = buildReportHtml(sales, radius, tfMonths);
    const text = buildReportText(sales, radius, tfMonths);
    await sendReportEmail(
      recipientEmail,
      html,
      text,
      SMTP_USER.value(),
      SMTP_PASS.value()
    );

    return { success: true };
  }
);

/**
 * Runs daily at 6 AM Central. Checks email config to decide
 * whether to fetch data and send a report.
 *
 * - Weekly: sends every Monday
 * - Monthly: sends on the 1st
 */
export const scheduledReport = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [SMTP_USER, SMTP_PASS],
  },
  async () => {
    // 1. Check email config
    const emailSnap = await db.doc("config/email").get();
    if (!emailSnap.exists) {
      console.log("No email config found, skipping.");
      return;
    }
    const emailConfig = emailSnap.data() as {
      recipientEmail: string;
      schedule: "weekly" | "monthly" | "quarterly" | "biannual";
      timeframeMonths: number;
      radiusMiles: number;
      enabled: boolean;
    };

    if (!emailConfig.enabled || !emailConfig.recipientEmail) {
      console.log("Email reports disabled or no recipient, skipping.");
      return;
    }

    // 2. Check if today matches the schedule
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
    const dayOfMonth = now.getDate();
    const month = now.getMonth(); // 0=Jan

    if (emailConfig.schedule === "weekly" && dayOfWeek !== 1) {
      console.log("Weekly schedule: not Monday, skipping.");
      return;
    }
    if (emailConfig.schedule === "monthly" && dayOfMonth !== 1) {
      console.log("Monthly schedule: not the 1st, skipping.");
      return;
    }
    if (emailConfig.schedule === "quarterly" && (dayOfMonth !== 1 || month % 3 !== 0)) {
      console.log("Quarterly schedule: not the 1st of a quarter month, skipping.");
      return;
    }
    if (emailConfig.schedule === "biannual" && (dayOfMonth !== 1 || (month !== 0 && month !== 6))) {
      console.log("Biannual schedule: not Jan 1 or Jul 1, skipping.");
      return;
    }

    console.log(`Schedule matched (${emailConfig.schedule}), running pipeline and sending report.`);

    // 3. Run the data pipeline
    try {
      await runPipeline();
    } catch (error) {
      console.error("Pipeline failed during scheduled report:", error);
    }

    // 4. Query sales for the report
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - emailConfig.timeframeMonths);

    const salesSnap = await db
      .collection("sales")
      .where("saleDate", ">=", admin.firestore.Timestamp.fromDate(cutoffDate))
      .orderBy("saleDate", "desc")
      .get();

    const sales = salesSnap.docs
      .map((d) => d.data())
      .filter(
        (s) =>
          s.distanceMiles != null &&
          s.distanceMiles <= emailConfig.radiusMiles
      )
      .map((s) => ({
        buyer: s.buyer as string,
        address: s.address as string,
        city: s.city as string,
        zip: s.zip as string,
        distanceMiles: s.distanceMiles as number,
        saleDate: (s.saleDate as admin.firestore.Timestamp).toDate(),
      }));

    // 5. Build and send email
    const html = buildReportHtml(
      sales,
      emailConfig.radiusMiles,
      emailConfig.timeframeMonths
    );

    const text = buildReportText(
      sales,
      emailConfig.radiusMiles,
      emailConfig.timeframeMonths
    );

    try {
      await sendReportEmail(
        emailConfig.recipientEmail,
        html,
        text,
        SMTP_USER.value(),
        SMTP_PASS.value()
      );
      console.log(`Report sent to ${emailConfig.recipientEmail} with ${sales.length} sales.`);
    } catch (error) {
      console.error("Failed to send report email:", error);
    }
  }
);
