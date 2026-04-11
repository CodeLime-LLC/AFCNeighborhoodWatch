import { parse } from "csv-parse/sync";
import { RawSaleRow, SaleRecord } from "./types";

const BASE_URL =
  "https://web.assess.co.polk.ia.us/info/web/exports/res/sales/juris";

/**
 * Fetch CSV data from Polk County Assessor for a given jurisdiction and year.
 */
export async function fetchCsv(
  jurisdictionCode: string,
  year: number
): Promise<string> {
  const url = `${BASE_URL}/${jurisdictionCode}/${year}.csv`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status} from ${url}`);
  }
  return response.text();
}

/**
 * Parse CSV text into raw sale row objects.
 */
export function parseCsv(csvText: string): RawSaleRow[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  return records.map((row) => ({
    sale_date: row["sale_date"] ?? "",
    price: row["price"] ?? "",
    address: row["address"] ?? "",
    zip: row["zip"] ?? "",
    buyer: row["buyer"] ?? "",
    seller: row["seller"] ?? "",
    quality1: row["quality1"] ?? "",
    book: row["book"] ?? "",
    pg: row["pg"] ?? "",
    occupancy: row["occupancy"] ?? "",
    residence_type: row["residence_type"] ?? "",
    total_living_area: row["total_living_area"] ?? "",
    year_built: row["year_built"] ?? "",
  }));
}

/**
 * Filter rows to arm's-length sales within the given date range.
 */
export function filterByDateAndQuality(
  rows: RawSaleRow[],
  cutoffDate: Date
): RawSaleRow[] {
  return rows.filter((row) => {
    if (row.quality1 !== "Arms Length") return false;

    const saleDate = parseDate(row.sale_date);
    if (!saleDate) return false;

    return saleDate >= cutoffDate;
  });
}

/**
 * Convert raw rows to SaleRecord objects.
 */
export function toSaleRecords(
  rows: RawSaleRow[],
  fetchYear: number
): SaleRecord[] {
  const results: SaleRecord[] = [];
  for (const row of rows) {
    const saleDate = parseDate(row.sale_date);
    if (!saleDate) continue;

    results.push({
      address: row.address,
      city: "ANKENY",
      zip: row.zip,
      buyer: row.buyer,
      seller: row.seller,
      saleDate,
      price: parseInt(row.price, 10) || 0,
      lat: null,
      lon: null,
      distanceMiles: null,
      residenceType: row.occupancy || row.residence_type,
      totalLivingArea: parseInt(row.total_living_area, 10) || null,
      yearBuilt: parseInt(row.year_built, 10) || null,
      quality1: row.quality1,
      geocodeStatus: "no_match",
      fetchYear,
      sourceKey: `${row.book}-${row.pg}`,
    });
  }
  return results;
}

/**
 * Remove records whose sourceKey already exists in the provided set.
 */
export function dedup(
  records: SaleRecord[],
  existingKeys: Set<string>
): SaleRecord[] {
  return records.filter((r) => !existingKeys.has(r.sourceKey));
}

/**
 * Get the years we need to fetch CSVs for, based on the timeframe.
 */
export function getYearsToFetch(timeframeMonths: number): number[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - timeframeMonths);
  const cutoffYear = cutoff.getFullYear();

  const years = [currentYear];
  if (cutoffYear < currentYear) {
    years.push(cutoffYear);
  }
  return years;
}

/**
 * Parse date strings like "03/15/2026" or "2026-03-15".
 */
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Try MM/DD/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return new Date(
      parseInt(slashMatch[3]),
      parseInt(slashMatch[1]) - 1,
      parseInt(slashMatch[2])
    );
  }

  // Try YYYY-MM-DD
  const dashMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dashMatch) {
    return new Date(
      parseInt(dashMatch[1]),
      parseInt(dashMatch[2]) - 1,
      parseInt(dashMatch[3])
    );
  }

  return null;
}
