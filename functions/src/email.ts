import * as nodemailer from "nodemailer";

export interface EmailConfig {
  recipientEmail: string;
  schedule: "weekly" | "monthly";
  timeframeMonths: number;
  radiusMiles: number;
  enabled: boolean;
}

export interface ReportSale {
  buyer: string;
  address: string;
  city: string;
  zip: string;
  distanceMiles: number;
  saleDate: Date;
}

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function buildReportHtml(
  sales: ReportSale[],
  radiusMiles: number,
  timeframeMonths: number
): string {
  const rows = sales
    .map(
      (s) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${titleCase(s.buyer)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${titleCase(s.address)}, ${titleCase(s.city)} ${s.zip}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${s.distanceMiles.toFixed(1)} mi</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${formatDate(s.saleDate)}</td>
      </tr>`
    )
    .join("");

  const timeLabel =
    timeframeMonths === 1
      ? "1 month"
      : `${timeframeMonths} months`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#1e40af">AFC Neighborhood Watch Report</h2>
      <p style="color:#555">
        <strong>${sales.length}</strong> new mover${sales.length !== 1 ? "s" : ""}
        within <strong>${radiusMiles} miles</strong> in the last <strong>${timeLabel}</strong>.
      </p>
      ${
        sales.length > 0
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
          : `<p style="color:#888">No new movers found for this period.</p>`
      }
      <p style="color:#aaa;font-size:12px;margin-top:24px">
        Sent automatically by AFC Neighborhood Watch
      </p>
    </div>
  `;
}

export function buildReportText(
  sales: ReportSale[],
  radiusMiles: number,
  timeframeMonths: number
): string {
  const timeLabel =
    timeframeMonths === 1
      ? "1 month"
      : `${timeframeMonths} months`;

  let text = `AFC Neighborhood Watch Report\n`;
  text += `${"=".repeat(40)}\n\n`;
  text += `${sales.length} new mover${sales.length !== 1 ? "s" : ""} within ${radiusMiles} miles in the last ${timeLabel}.\n\n`;

  if (sales.length > 0) {
    for (const s of sales) {
      text += `${titleCase(s.buyer)}\n`;
      text += `  ${titleCase(s.address)}, ${titleCase(s.city)} ${s.zip}\n`;
      text += `  ${s.distanceMiles.toFixed(1)} mi  |  ${formatDate(s.saleDate)}\n\n`;
    }
  } else {
    text += "No new movers found for this period.\n";
  }

  text += `---\nSent automatically by AFC Neighborhood Watch\n`;
  return text;
}

export async function sendReportEmail(
  to: string,
  html: string,
  text: string,
  smtpUser: string,
  smtpPass: string
): Promise<void> {
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
    text,
    html,
  });
}
