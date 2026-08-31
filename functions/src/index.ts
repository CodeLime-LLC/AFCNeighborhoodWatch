import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import {
  fetchCsv,
  parseCsv,
  filterByDateAndQuality,
  toSaleRecords,
  getYearsToFetch,
  maxSaleDate,
} from "./fetchSales";
import {
  fetchInventoryCsv,
  parseTransfers,
  toSaleRecordsFromTransfers,
} from "./fetchTransfers";
import { geocodeAddress, batchGeocode, haversineDistanceMiles } from "./geocode";
import {
  buildReportHtml,
  buildReportText,
  buildReportSubject,
  sendReportEmail,
  isSourceStale,
  ReportContext,
  ReportSale,
  SourceStatus,
} from "./email";
import { ChurchConfig, ProcessResult, SaleRecord } from "./types";

admin.initializeApp();
const db = admin.firestore();

const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");

const BATCH_SIZE = 500;

const CHURCH_LAT = 41.7322;
const CHURCH_LON = -93.6295;

/** Reads how fresh the county export was as of the last pipeline run. */
async function readSourceStatus(): Promise<SourceStatus> {
  const snap = await db.doc("config/church").get();
  const data = snap.data() ?? {};
  const salesMax =
    (data.sourceMaxSaleDate as admin.firestore.Timestamp | null)?.toDate() ??
    null;
  const transferMax =
    (data.sourceMaxTransferDate as admin.firestore.Timestamp | null)?.toDate() ??
    null;
  const newestSaleDate =
    salesMax && transferMax
      ? new Date(Math.max(salesMax.getTime(), transferMax.getTime()))
      : salesMax ?? transferMax;
  const lastUpdated =
    (data.sourceLastModified as admin.firestore.Timestamp | null)?.toDate() ??
    null;
  return {
    newestSaleDate,
    lastUpdated,
    stale: isSourceStale(newestSaleDate),
  };
}

/**
 * Movers first ingested in (watermark, runAt]. Bounding both ends means a
 * record written while the query runs is neither reported twice nor skipped.
 */
async function moversSince(
  watermark: Date,
  runAt: Date,
  radiusMiles: number
): Promise<ReportSale[]> {
  const snap = await db
    .collection("sales")
    .where("createdAt", ">", admin.firestore.Timestamp.fromDate(watermark))
    .where("createdAt", "<=", admin.firestore.Timestamp.fromDate(runAt))
    .orderBy("createdAt", "asc")
    .get();

  return snap.docs
    .map((d) => d.data())
    .filter((s) => s.distanceMiles != null && s.distanceMiles <= radiusMiles)
    .map((s) => ({
      buyer: s.buyer as string,
      address: s.address as string,
      city: s.city as string,
      zip: s.zip as string,
      distanceMiles: s.distanceMiles as number,
      saleDate: (s.saleDate as admin.firestore.Timestamp).toDate(),
    }))
    .sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime());
}

function monthsBefore(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() - months);
  return out;
}

/**
 * Core pipeline: fetch CSV, parse, geocode, store.
 * Used by both manual trigger and scheduled function.
 */
async function runPipeline(
  trigger: "manual" | "scheduled"
): Promise<ProcessResult> {
  console.log(`Pipeline started (${trigger})`);

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
  let yearsFetched = 0;
  let sourceLastModified: Date | null = null;
  for (const year of years) {
    try {
      console.log(`Fetching CSV for year ${year}...`);
      const { text, lastModified } = await fetchCsv(config.jurisdictionCode, year);
      const rows = parseCsv(text);
      console.log(`Year ${year}: ${rows.length} rows parsed`);
      allRows = allRows.concat(rows);
      yearsFetched++;
      if (lastModified && (!sourceLastModified || lastModified > sourceLastModified)) {
        sourceLastModified = lastModified;
      }
    } catch (error) {
      console.warn(`Failed to fetch CSV for year ${year}:`, error);
    }
  }

  // A source outage must never be recorded as a successful, empty run — that
  // is indistinguishable from "no new sales" and is how a stalled feed hides.
  if (yearsFetched === 0) {
    await db.doc("config/church").update({
      lastFetchDate: admin.firestore.FieldValue.serverTimestamp(),
      lastFetchStatus: "error",
      lastFetchCount: 0,
    });
    await db.collection("fetchLogs").add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      trigger,
      status: "error",
      totalRecords: 0,
      armsLengthRecords: 0,
      newRecordsAdded: 0,
      geocodeFailures: 0,
    });
    throw new HttpsError(
      "unavailable",
      "Could not fetch any data from the Polk County Assessor."
    );
  }

  // How fresh the sales export is, independent of what survives our filters.
  const sourceMaxSaleDate = maxSaleDate(allRows);

  // 4. Filter by date and quality
  const filtered = filterByDateAndQuality(allRows, cutoffDate);
  const salesRecords = toSaleRecords(filtered, years[0]);
  console.log(`Filtered to ${filtered.length} arm's-length sales, ${salesRecords.length} records`);

  // 4b. Fall back to the inventory export. The sales export stalled through
  //     August 2026 while this one stayed current, and reading only the former
  //     made a broken feed look like a month with no sales at all.
  let inventoryRecords: SaleRecord[] = [];
  let sourceMaxTransferDate: Date | null = null;
  try {
    const inventory = await fetchInventoryCsv(config.jurisdictionCode);
    const { rows: transfers, newestTransfer } = parseTransfers(
      inventory.text,
      cutoffDate
    );
    sourceMaxTransferDate = newestTransfer;
    inventoryRecords = toSaleRecordsFromTransfers(transfers, years[0], "ANKENY");
    console.log(
      `Inventory: newest transfer ${newestTransfer?.toISOString().slice(0, 10) ?? "none"}, ` +
        `${transfers.length} recent owner-occupied residential transfers`
    );
  } catch (error) {
    console.warn("Inventory export unavailable:", error);
  }

  // 4c. Freshness of BOTH exports, so a stalled sales file is distinguishable
  //     from a genuinely quiet stretch.
  const sourceFields = {
    sourceMaxSaleDate: sourceMaxSaleDate
      ? admin.firestore.Timestamp.fromDate(sourceMaxSaleDate)
      : null,
    sourceMaxTransferDate: sourceMaxTransferDate
      ? admin.firestore.Timestamp.fromDate(sourceMaxTransferDate)
      : null,
    sourceLastModified: sourceLastModified
      ? admin.firestore.Timestamp.fromDate(sourceLastModified)
      : null,
  };
  console.log(
    `Freshness: sales export newest sale ` +
      `${sourceMaxSaleDate?.toISOString().slice(0, 10) ?? "none"} ` +
      `(file modified ${sourceLastModified?.toISOString() ?? "unknown"}); ` +
      `inventory newest transfer ` +
      `${sourceMaxTransferDate?.toISOString().slice(0, 10) ?? "none"}`
  );

  // 4d. One deed can appear in both exports. The sales export wins: it carries
  //     price and the arm's-length grading the inventory has no field for.
  const merged = new Map<string, SaleRecord>();
  for (const r of inventoryRecords) merged.set(r.sourceKey, r);
  for (const r of salesRecords) merged.set(r.sourceKey, r);
  const records = [...merged.values()];

  // 5. Dedup against existing records
  const existingSnap = await db
    .collection("sales")
    .select("sourceKey", "source")
    .get();
  const existing = new Map<string, { id: string; source: string }>();
  for (const doc of existingSnap.docs) {
    const key = doc.data().sourceKey as string;
    if (key) {
      existing.set(key, {
        id: doc.id,
        source: (doc.data().source as string) ?? "sales",
      });
    }
  }
  const newRecords = records.filter((r) => !existing.has(r.sourceKey));
  console.log(`${newRecords.length} new records after dedup (${existing.size} existing)`);

  // 5b. A deed first seen in the inventory, now published in the sales export,
  //     is upgraded in place. createdAt is deliberately untouched: it is the
  //     report watermark, and moving it would re-send a mover already emailed.
  const upgrades = records.filter(
    (r) => r.source === "sales" && existing.get(r.sourceKey)?.source === "inventory"
  );
  for (let i = 0; i < upgrades.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const r of upgrades.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection("sales").doc(existing.get(r.sourceKey)!.id), {
        source: "sales",
        quality1: r.quality1,
        price: r.price,
        buyer: r.buyer,
        seller: r.seller,
        saleDate: admin.firestore.Timestamp.fromDate(r.saleDate),
        residenceType: r.residenceType,
        totalLivingArea: r.totalLivingArea,
        yearBuilt: r.yearBuilt,
      });
    }
    await batch.commit();
  }
  if (upgrades.length > 0) {
    console.log(`Upgraded ${upgrades.length} inventory records with sales-export detail`);
  }

  if (newRecords.length === 0) {
    console.log("No new records to process");
    await db.doc("config/church").update({
      lastFetchDate: admin.firestore.FieldValue.serverTimestamp(),
      lastFetchStatus: "success",
      lastFetchCount: 0,
      ...sourceFields,
    });
    // Logged even when nothing changed, so a run of empty weeks is visible
    // in fetchLogs rather than looking like the job stopped running.
    await db.collection("fetchLogs").add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      trigger,
      status: "success",
      totalRecords: allRows.length,
      armsLengthRecords: filtered.length,
      newRecordsAdded: 0,
      geocodeFailures: 0,
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
    ...sourceFields,
  });

  // 10. Log the fetch
  await db.collection("fetchLogs").add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    trigger,
    status: "success",
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
    memory: "1GiB",
  },
  async () => {
    return runPipeline("manual");
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

    const radius = radiusMiles ?? 3;
    const lookbackMonths = timeframeMonths ?? 1;

    // Preview exactly what the next real report would contain, without
    // consuming the watermark — a test send must not skip a live report.
    const emailSnap = await db.doc("config/email").get();
    const storedWatermark =
      (emailSnap.data()?.lastReportAt as admin.firestore.Timestamp | undefined)
        ?.toDate() ?? null;
    const runAt = new Date();
    const watermark = storedWatermark ?? monthsBefore(runAt, lookbackMonths);

    const sales = await moversSince(watermark, runAt, radius);
    const ctx: ReportContext = {
      radiusMiles: radius,
      since: storedWatermark,
      source: await readSourceStatus(),
    };

    await sendReportEmail(
      recipientEmail,
      buildReportHtml(sales, ctx),
      buildReportText(sales, ctx),
      SMTP_USER.value(),
      SMTP_PASS.value(),
      buildReportSubject(sales, ctx)
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
    memory: "1GiB",
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
      lastReportAt?: admin.firestore.Timestamp;
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
      await runPipeline("scheduled");
    } catch (error) {
      console.error("Pipeline failed during scheduled report:", error);
    }

    // 4. Movers are selected by when we DISCOVERED them, not by sale date.
    //    The county publishes weeks late, so a sale-date window drops anyone
    //    published after it has moved on. A watermark cannot lose them.
    const storedWatermark = emailConfig.lastReportAt?.toDate() ?? null;
    const runAt = new Date();
    const watermark =
      storedWatermark ?? monthsBefore(runAt, emailConfig.timeframeMonths);

    const sales = await moversSince(watermark, runAt, emailConfig.radiusMiles);
    const source = await readSourceStatus();
    console.log(
      `${sales.length} new movers since ${watermark.toISOString()}; ` +
        `source stale: ${source.stale}`
    );

    // 5. A healthy feed with nothing new is not worth an email. A stalled
    //    feed is — silence there would look identical to a quiet week.
    if (sales.length === 0 && !source.stale) {
      console.log("No new movers and the county feed is current — no email sent.");
      await db.doc("config/email").update({
        lastReportAt: admin.firestore.Timestamp.fromDate(runAt),
      });
      return;
    }

    // 6. Build and send
    const ctx: ReportContext = {
      radiusMiles: emailConfig.radiusMiles,
      since: storedWatermark,
      source,
    };

    try {
      await sendReportEmail(
        emailConfig.recipientEmail,
        buildReportHtml(sales, ctx),
        buildReportText(sales, ctx),
        SMTP_USER.value(),
        SMTP_PASS.value(),
        buildReportSubject(sales, ctx)
      );
      console.log(`Report sent to ${emailConfig.recipientEmail} with ${sales.length} sales.`);

      // Advanced only after a confirmed send, so a failed delivery re-reports
      // these movers next week instead of dropping them.
      await db.doc("config/email").update({
        lastReportAt: admin.firestore.Timestamp.fromDate(runAt),
      });
    } catch (error) {
      console.error("Failed to send report email:", error);
    }
  }
);
