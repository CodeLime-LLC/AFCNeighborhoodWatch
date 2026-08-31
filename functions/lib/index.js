"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledReport = exports.sendTestEmail = exports.geocodeAddressFn = exports.processSales = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const fetchSales_1 = require("./fetchSales");
const geocode_1 = require("./geocode");
const email_1 = require("./email");
admin.initializeApp();
const db = admin.firestore();
const SMTP_USER = (0, params_1.defineSecret)("SMTP_USER");
const SMTP_PASS = (0, params_1.defineSecret)("SMTP_PASS");
const CHURCH_LAT = 41.7322;
const CHURCH_LON = -93.6295;
/** Reads how fresh the county export was as of the last pipeline run. */
async function readSourceStatus() {
    const snap = await db.doc("config/church").get();
    const data = snap.data() ?? {};
    const newestSaleDate = data.sourceMaxSaleDate?.toDate() ??
        null;
    const lastUpdated = data.sourceLastModified?.toDate() ??
        null;
    return {
        newestSaleDate,
        lastUpdated,
        stale: (0, email_1.isSourceStale)(newestSaleDate),
    };
}
/**
 * Movers first ingested in (watermark, runAt]. Bounding both ends means a
 * record written while the query runs is neither reported twice nor skipped.
 */
async function moversSince(watermark, runAt, radiusMiles) {
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
        buyer: s.buyer,
        address: s.address,
        city: s.city,
        zip: s.zip,
        distanceMiles: s.distanceMiles,
        saleDate: s.saleDate.toDate(),
    }))
        .sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime());
}
function monthsBefore(d, months) {
    const out = new Date(d);
    out.setMonth(out.getMonth() - months);
    return out;
}
/**
 * Core pipeline: fetch CSV, parse, geocode, store.
 * Used by both manual trigger and scheduled function.
 */
async function runPipeline(trigger) {
    console.log(`Pipeline started (${trigger})`);
    // 1. Load church config
    const configSnap = await db.doc("config/church").get();
    if (!configSnap.exists) {
        throw new https_1.HttpsError("not-found", "Church config not found.");
    }
    const config = configSnap.data();
    // 2. Determine date range and years to fetch
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - config.timeframeMonths);
    const years = (0, fetchSales_1.getYearsToFetch)(config.timeframeMonths);
    console.log(`Fetching years: ${years.join(", ")}, cutoff: ${cutoffDate.toISOString()}`);
    // 3. Fetch and parse CSVs
    let allRows = [];
    let yearsFetched = 0;
    let sourceLastModified = null;
    for (const year of years) {
        try {
            console.log(`Fetching CSV for year ${year}...`);
            const { text, lastModified } = await (0, fetchSales_1.fetchCsv)(config.jurisdictionCode, year);
            const rows = (0, fetchSales_1.parseCsv)(text);
            console.log(`Year ${year}: ${rows.length} rows parsed`);
            allRows = allRows.concat(rows);
            yearsFetched++;
            if (lastModified && (!sourceLastModified || lastModified > sourceLastModified)) {
                sourceLastModified = lastModified;
            }
        }
        catch (error) {
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
        throw new https_1.HttpsError("unavailable", "Could not fetch any data from the Polk County Assessor.");
    }
    // How fresh the export is, independent of what survives our filters.
    const sourceMaxSaleDate = (0, fetchSales_1.maxSaleDate)(allRows);
    const sourceFields = {
        sourceMaxSaleDate: sourceMaxSaleDate
            ? admin.firestore.Timestamp.fromDate(sourceMaxSaleDate)
            : null,
        sourceLastModified: sourceLastModified
            ? admin.firestore.Timestamp.fromDate(sourceLastModified)
            : null,
    };
    console.log(`Source freshness: newest sale ${sourceMaxSaleDate?.toISOString().slice(0, 10) ?? "none"}, ` +
        `file modified ${sourceLastModified?.toISOString() ?? "unknown"}`);
    // 4. Filter by date and quality
    const filtered = (0, fetchSales_1.filterByDateAndQuality)(allRows, cutoffDate);
    const records = (0, fetchSales_1.toSaleRecords)(filtered, years[0]);
    console.log(`Filtered to ${filtered.length} arm's-length sales, ${records.length} records`);
    // 5. Dedup against existing records
    const existingSnap = await db.collection("sales").select("sourceKey").get();
    const existingKeys = new Set(existingSnap.docs.map((d) => d.data().sourceKey));
    const newRecords = (0, fetchSales_1.dedup)(records, existingKeys);
    console.log(`${newRecords.length} new records after dedup (${existingKeys.size} existing)`);
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
    const geocodeResults = await (0, geocode_1.batchGeocode)(addressesToGeocode);
    let errors = 0;
    for (let i = 0; i < newRecords.length; i++) {
        const result = geocodeResults.get(String(i));
        if (result) {
            newRecords[i].lat = result.lat;
            newRecords[i].lon = result.lon;
            newRecords[i].geocodeStatus = "matched";
            newRecords[i].distanceMiles = (0, geocode_1.haversineDistanceMiles)(CHURCH_LAT, CHURCH_LON, result.lat, result.lon);
        }
        else {
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
        totalInRadius = recentSalesSnap.docs.filter((d) => (d.data().distanceMiles ?? Infinity) <= config.radiusMiles).length;
    }
    catch (err) {
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
exports.processSales = (0, https_1.onCall)({
    timeoutSeconds: 540,
    memory: "512MiB",
}, async () => {
    return runPipeline("manual");
});
/**
 * Geocode a single address — used by the settings page.
 */
exports.geocodeAddressFn = (0, https_1.onCall)(async (request) => {
    const { address } = request.data;
    if (!address) {
        throw new https_1.HttpsError("invalid-argument", "Address is required.");
    }
    const result = await (0, geocode_1.geocodeAddress)(address);
    if (!result) {
        throw new https_1.HttpsError("not-found", "Could not geocode address.");
    }
    return result;
});
/**
 * Send a test email — callable from the frontend.
 * Pulls real sales data using the saved email config settings.
 */
exports.sendTestEmail = (0, https_1.onCall)({
    secrets: [SMTP_USER, SMTP_PASS],
    timeoutSeconds: 60,
}, async (request) => {
    const { recipientEmail, timeframeMonths, radiusMiles } = request.data;
    if (!recipientEmail) {
        throw new https_1.HttpsError("invalid-argument", "Recipient email is required.");
    }
    const radius = radiusMiles ?? 3;
    const lookbackMonths = timeframeMonths ?? 1;
    // Preview exactly what the next real report would contain, without
    // consuming the watermark — a test send must not skip a live report.
    const emailSnap = await db.doc("config/email").get();
    const storedWatermark = emailSnap.data()?.lastReportAt
        ?.toDate() ?? null;
    const runAt = new Date();
    const watermark = storedWatermark ?? monthsBefore(runAt, lookbackMonths);
    const sales = await moversSince(watermark, runAt, radius);
    const ctx = {
        radiusMiles: radius,
        since: storedWatermark,
        source: await readSourceStatus(),
    };
    await (0, email_1.sendReportEmail)(recipientEmail, (0, email_1.buildReportHtml)(sales, ctx), (0, email_1.buildReportText)(sales, ctx), SMTP_USER.value(), SMTP_PASS.value(), (0, email_1.buildReportSubject)(sales, ctx));
    return { success: true };
});
/**
 * Runs daily at 6 AM Central. Checks email config to decide
 * whether to fetch data and send a report.
 *
 * - Weekly: sends every Monday
 * - Monthly: sends on the 1st
 */
exports.scheduledReport = (0, scheduler_1.onSchedule)({
    schedule: "0 6 * * *",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [SMTP_USER, SMTP_PASS],
}, async () => {
    // 1. Check email config
    const emailSnap = await db.doc("config/email").get();
    if (!emailSnap.exists) {
        console.log("No email config found, skipping.");
        return;
    }
    const emailConfig = emailSnap.data();
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
    }
    catch (error) {
        console.error("Pipeline failed during scheduled report:", error);
    }
    // 4. Movers are selected by when we DISCOVERED them, not by sale date.
    //    The county publishes weeks late, so a sale-date window drops anyone
    //    published after it has moved on. A watermark cannot lose them.
    const storedWatermark = emailConfig.lastReportAt?.toDate() ?? null;
    const runAt = new Date();
    const watermark = storedWatermark ?? monthsBefore(runAt, emailConfig.timeframeMonths);
    const sales = await moversSince(watermark, runAt, emailConfig.radiusMiles);
    const source = await readSourceStatus();
    console.log(`${sales.length} new movers since ${watermark.toISOString()}; ` +
        `source stale: ${source.stale}`);
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
    const ctx = {
        radiusMiles: emailConfig.radiusMiles,
        since: storedWatermark,
        source,
    };
    try {
        await (0, email_1.sendReportEmail)(emailConfig.recipientEmail, (0, email_1.buildReportHtml)(sales, ctx), (0, email_1.buildReportText)(sales, ctx), SMTP_USER.value(), SMTP_PASS.value(), (0, email_1.buildReportSubject)(sales, ctx));
        console.log(`Report sent to ${emailConfig.recipientEmail} with ${sales.length} sales.`);
        // Advanced only after a confirmed send, so a failed delivery re-reports
        // these movers next week instead of dropping them.
        await db.doc("config/email").update({
            lastReportAt: admin.firestore.Timestamp.fromDate(runAt),
        });
    }
    catch (error) {
        console.error("Failed to send report email:", error);
    }
});
//# sourceMappingURL=index.js.map