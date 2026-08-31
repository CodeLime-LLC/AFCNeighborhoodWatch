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
exports.STALE_AFTER_DAYS = void 0;
exports.isSourceStale = isSourceStale;
exports.buildReportHtml = buildReportHtml;
exports.buildReportText = buildReportText;
exports.buildReportSubject = buildReportSubject;
exports.sendReportEmail = sendReportEmail;
const nodemailer = __importStar(require("nodemailer"));
const AUDIT_BCC = "tyler@codelime.dev";
/**
 * Polk County publishes sales well after they close — median 16 days, with a
 * long tail past 100 days. Past this many days with no newer sale at all, the
 * export has stopped moving rather than merely lagging.
 */
exports.STALE_AFTER_DAYS = 21;
/** A missing newest-sale date counts as stale: we cannot vouch for the feed. */
function isSourceStale(newestSaleDate, now = new Date()) {
    if (!newestSaleDate)
        return true;
    return (Math.floor((now.getTime() - newestSaleDate.getTime()) / 86_400_000) >
        exports.STALE_AFTER_DAYS);
}
function titleCase(str) {
    return str
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
/**
 * Sale dates are stored as midnight UTC standing for a calendar day, so they
 * must be rendered in UTC — formatting them in Central shifts them a day back.
 */
function formatSaleDate(d) {
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    });
}
/** Real instants (watermarks, file timestamps) are shown in the church's time. */
function formatCentral(d) {
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Chicago",
    });
}
function daysAgo(d) {
    return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}
function staleNoticeHtml(source) {
    if (!source?.stale)
        return "";
    const newest = source.newestSaleDate
        ? `The most recent sale on file is <strong>${formatSaleDate(source.newestSaleDate)}</strong>, ${daysAgo(source.newestSaleDate)} days ago.`
        : "No sale dates are currently available from the county.";
    const updated = source.lastUpdated
        ? ` The county last refreshed the export on ${formatCentral(source.lastUpdated)}.`
        : "";
    return `
      <div style="background:#fef3c7;border-left:4px solid #d97706;padding:12px 16px;margin:16px 0;color:#78350f;font-size:14px">
        <strong>Heads up — the county's records look stalled.</strong><br />
        ${newest}${updated} New movers may be missing from this report until
        Polk County catches up. Nothing has been lost: they will appear here
        as soon as the county publishes them.
      </div>`;
}
function staleNoticeText(source) {
    if (!source?.stale)
        return "";
    const newest = source.newestSaleDate
        ? `The most recent sale on file is ${formatSaleDate(source.newestSaleDate)}, ${daysAgo(source.newestSaleDate)} days ago.`
        : "No sale dates are currently available from the county.";
    const updated = source.lastUpdated
        ? ` The county last refreshed the export on ${formatCentral(source.lastUpdated)}.`
        : "";
    return (`! HEADS UP - the county's records look stalled.\n` +
        `${newest}${updated}\n` +
        `New movers may be missing until Polk County catches up. Nothing has\n` +
        `been lost: they will appear as soon as the county publishes them.\n\n`);
}
/**
 * Movers are reported by when we discovered them, not by sale date, because
 * the county publishes sales weeks late (median 16 days, sometimes months).
 * A sale-date window silently drops anything published after it moves on.
 */
function summaryLine(sales, ctx) {
    const count = `${sales.length} new mover${sales.length !== 1 ? "s" : ""}`;
    const where = `within ${ctx.radiusMiles} miles`;
    return ctx.since
        ? `${count} ${where}, found since ${formatCentral(ctx.since)}.`
        : `${count} ${where}.`;
}
function buildReportHtml(sales, ctx) {
    const rows = sales
        .map((s) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${titleCase(s.buyer)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${titleCase(s.address)}, ${titleCase(s.city)} ${s.zip}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${s.distanceMiles.toFixed(1)} mi</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${formatSaleDate(s.saleDate)}</td>
      </tr>`)
        .join("");
    const empty = ctx.source?.stale
        ? `<p style="color:#888">No new movers to report while the county's records are stalled.</p>`
        : `<p style="color:#888">No new movers found since the last report.</p>`;
    return `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#1e40af">AFC Neighborhood Watch Report</h2>
      ${staleNoticeHtml(ctx.source)}
      <p style="color:#555">
        <strong>${sales.length}</strong> new mover${sales.length !== 1 ? "s" : ""}
        within <strong>${ctx.radiusMiles} miles</strong>${ctx.since ? `, found since <strong>${formatCentral(ctx.since)}</strong>` : ""}.
      </p>
      ${sales.length > 0
        ? `
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px;text-align:left">Name</th>
              <th style="padding:8px;text-align:left">Address</th>
              <th style="padding:8px;text-align:right">Distance</th>
              <th style="padding:8px;text-align:left">Move Date</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
        : empty}
      <p style="color:#aaa;font-size:12px;margin-top:24px">
        Sent automatically by AFC Neighborhood Watch
      </p>
    </div>
  `;
}
function buildReportText(sales, ctx) {
    let text = `AFC Neighborhood Watch Report\n`;
    text += `${"=".repeat(40)}\n\n`;
    text += staleNoticeText(ctx.source);
    text += `${summaryLine(sales, ctx)}\n\n`;
    if (sales.length > 0) {
        for (const s of sales) {
            text += `${titleCase(s.buyer)}\n`;
            text += `  ${titleCase(s.address)}, ${titleCase(s.city)} ${s.zip}\n`;
            text += `  ${s.distanceMiles.toFixed(1)} mi  |  ${formatSaleDate(s.saleDate)}\n\n`;
        }
    }
    else if (ctx.source?.stale) {
        text += "No new movers to report while the county's records are stalled.\n";
    }
    else {
        text += "No new movers found since the last report.\n";
    }
    text += `---\nSent automatically by AFC Neighborhood Watch\n`;
    return text;
}
/** A stalled feed is news in its own right, so it gets its own subject line. */
function buildReportSubject(sales, ctx) {
    const today = formatCentral(new Date());
    if (sales.length === 0 && ctx.source?.stale) {
        return `New Movers Report — county data delayed (${today})`;
    }
    return `New Movers Report — ${today}`;
}
async function sendReportEmail(to, html, text, smtpUser, smtpPass, subject) {
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });
    await transporter.sendMail({
        from: `"AFC Neighborhood Watch" <${smtpUser}>`,
        to,
        bcc: AUDIT_BCC,
        subject: subject ??
            `New Movers Report — ${new Date().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "America/Chicago",
            })}`,
        text,
        html,
    });
}
//# sourceMappingURL=email.js.map