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
exports.buildReportHtml = buildReportHtml;
exports.sendReportEmail = sendReportEmail;
const nodemailer = __importStar(require("nodemailer"));
function titleCase(str) {
    return str
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
function formatCurrency(n) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(n);
}
function formatDate(d) {
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}
function buildReportHtml(sales, radiusMiles, timeframeMonths) {
    const rows = sales
        .map((s) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${titleCase(s.buyer)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${titleCase(s.address)}, ${titleCase(s.city)} ${s.zip}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${s.distanceMiles.toFixed(1)} mi</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${formatDate(s.saleDate)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(s.price)}</td>
      </tr>`)
        .join("");
    const timeLabel = timeframeMonths === 1
        ? "1 month"
        : `${timeframeMonths} months`;
    return `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#1e40af">AFC Neighborhood Watch Report</h2>
      <p style="color:#555">
        <strong>${sales.length}</strong> new mover${sales.length !== 1 ? "s" : ""}
        within <strong>${radiusMiles} miles</strong> in the last <strong>${timeLabel}</strong>.
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
              <th style="padding:8px;text-align:right">Price</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
        : `<p style="color:#888">No new movers found for this period.</p>`}
      <p style="color:#aaa;font-size:12px;margin-top:24px">
        Sent automatically by AFC Neighborhood Watch
      </p>
    </div>
  `;
}
async function sendReportEmail(to, html, smtpUser, smtpPass) {
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
        subject: `New Movers Report — ${new Date().toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
        })}`,
        html,
    });
}
//# sourceMappingURL=email.js.map