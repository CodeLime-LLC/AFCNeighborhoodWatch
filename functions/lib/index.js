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
/**
 * Core pipeline: fetch CSV, parse, geocode, store.
 * Used by both manual trigger and scheduled function.
 */
async function runPipeline() {
    console.log("Pipeline started");
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
    for (const year of years) {
        try {
            console.log(`Fetching CSV for year ${year}...`);
            const csv = await (0, fetchSales_1.fetchCsv)(config.jurisdictionCode, year);
            const rows = (0, fetchSales_1.parseCsv)(csv);
            console.log(`Year ${year}: ${rows.length} rows parsed`);
            allRows = allRows.concat(rows);
        }
        catch (error) {
            console.warn(`Failed to fetch CSV for year ${year}:`, error);
        }
    }
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
exports.processSales = (0, https_1.onCall)({
    timeoutSeconds: 540,
    memory: "512MiB",
}, async () => {
    return runPipeline();
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
 */
exports.sendTestEmail = (0, https_1.onCall)({
    secrets: [SMTP_USER, SMTP_PASS],
    timeoutSeconds: 30,
}, async (request) => {
    const { recipientEmail } = request.data;
    if (!recipientEmail) {
        throw new https_1.HttpsError("invalid-argument", "Recipient email is required.");
    }
    const html = (0, email_1.buildReportHtml)([], 3, 1);
    await (0, email_1.sendReportEmail)(recipientEmail, html, SMTP_USER.value(), SMTP_PASS.value());
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
        await runPipeline();
    }
    catch (error) {
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
        .filter((s) => s.distanceMiles != null &&
        s.distanceMiles <= emailConfig.radiusMiles)
        .map((s) => ({
        buyer: s.buyer,
        address: s.address,
        city: s.city,
        zip: s.zip,
        distanceMiles: s.distanceMiles,
        saleDate: s.saleDate.toDate(),
        price: s.price,
    }));
    // 5. Build and send email
    const html = (0, email_1.buildReportHtml)(sales, emailConfig.radiusMiles, emailConfig.timeframeMonths);
    try {
        await (0, email_1.sendReportEmail)(emailConfig.recipientEmail, html, SMTP_USER.value(), SMTP_PASS.value());
        console.log(`Report sent to ${emailConfig.recipientEmail} with ${sales.length} sales.`);
    }
    catch (error) {
        console.error("Failed to send report email:", error);
    }
});
//# sourceMappingURL=index.js.map