import { parse } from "csv-parse/sync";
import { CsvFetchResult, parseSaleDate } from "./fetchSales";
import { SaleRecord, TransferRow } from "./types";

const INVENTORY_BASE_URL =
  "https://web.assess.co.polk.ia.us/info/web/exports/res/inven/juris";

/**
 * Dwelling types a household actually moves into. Blank occupancy is vacant
 * land and outbuildings; commercial types are not the church's audience.
 */
const RESIDENTIAL_OCCUPANCY = new Set([
  "Single Family",
  "Condominium",
  "Townhouse",
  "Bi-attached",
  "Duplex",
]);

/**
 * A title holder that reads as an organisation is re-titling, not moving in —
 * most often a homeowner shifting their own house into a family trust.
 *
 * Matched per whole word, never as a substring: " TRUST" inside "TRUSTIN" and
 * " BANK" inside a Banks surname would quietly drop real households.
 */
const ENTITY_WORDS = new Set([
  "TRUST", "TRUSTEE", "TRUSTEES", "LLC", "ESTATE", "BANK", "PROPERTIES",
  "PROPERTY", "INC", "LLP", "CORP", "CORPORATION", "PARTNERSHIP", "HOMES",
  "CHURCH", "COUNTY", "ASSOCIATION", "SCHOOL", "COMPANY", "GROUP",
  // Investor names that read like a person's until you look twice; the
  // Aug 2026 catch-up surfaced "DRIVEN HOLDINGS" past an earlier list.
  "HOLDINGS", "VENTURES", "INVESTMENT", "INVESTMENTS", "REALTY", "RENTAL",
  "RENTALS", "CAPITAL", "EQUITY", "ENTERPRISE", "ENTERPRISES", "DEVELOPMENT",
  "BUILDERS", "CONSTRUCTION", "ACQUISITION", "ACQUISITIONS", "FUND", "FUNDS",
  "SOLUTIONS", "FARMS",
]);

/** Forms that survive word-splitting badly, checked against the raw string. */
const ENTITY_PHRASES = ["CITY OF", "L.L.C", "L L C"];

/** Stems, for words whose endings vary (ministry / ministries). */
const ENTITY_STEMS = ["MINISTR"];

export function looksLikeEntity(name: string): boolean {
  const upper = name.toUpperCase();
  if (ENTITY_PHRASES.some((p) => upper.includes(p))) return true;
  return upper
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .some(
      (w) => ENTITY_WORDS.has(w) || ENTITY_STEMS.some((st) => w.startsWith(st))
    );
}

/**
 * The owner's mailing address matching the property is our only signal that
 * they actually live there rather than holding it as a rental.
 */
export function isOwnerOccupied(row: Record<string, string>): boolean {
  const same = (a: string, b: string) =>
    (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();
  return (
    same(row.house, row.mail_house) &&
    same(row.street, row.mail_street) &&
    same(row.zip, row.mail_zip)
  );
}

/**
 * Fetch the jurisdiction's property inventory. This is the assessor's other
 * public export and it keeps moving when the sales export stalls.
 */
export async function fetchInventoryCsv(
  jurisdictionCode: string
): Promise<CsvFetchResult> {
  const url = `${INVENTORY_BASE_URL}/${jurisdictionCode}.csv`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch inventory CSV: ${response.status} from ${url}`
    );
  }

  const header = response.headers.get("last-modified");
  const lastModified = header ? new Date(header) : null;

  return {
    text: await response.text(),
    lastModified:
      lastModified && !isNaN(lastModified.getTime()) ? lastModified : null,
  };
}

/**
 * Parse the inventory down to recent owner-occupied residential transfers.
 *
 * The file is ~20 MB and 27k rows per jurisdiction, so rows are filtered and
 * projected inside the parser via on_record — materialising every row with
 * its 130+ columns first is what would blow the function's memory budget.
 */
export function parseTransfers(
  csvText: string,
  cutoffDate: Date
): { rows: TransferRow[]; newestTransfer: Date | null } {
  let newestTransfer: Date | null = null;

  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    on_record: (row: Record<string, string>) => {
      const transferred = parseSaleDate(row.transfer_th1 ?? "");
      if (!transferred) return null;
      // Tracked before filtering: freshness is a property of the whole export.
      if (!newestTransfer || transferred > newestTransfer) {
        newestTransfer = transferred;
      }
      if (transferred < cutoffDate) return null;
      if (!RESIDENTIAL_OCCUPANCY.has(row.occupancy ?? "")) return null;
      if (!row.book_th1 || !row.pg_th1) return null;

      const owner = (row.title_holder1 ?? "").trim();
      if (!owner) return null;
      if (!isOwnerOccupied(row)) return null;
      if (looksLikeEntity(owner)) return null;

      return {
        transferDate: row.transfer_th1,
        book: row.book_th1,
        pg: row.pg_th1,
        owner,
        address: row.address_line1 ?? "",
        city: row.city ?? "",
        zip: row.zip ?? "",
        occupancy: row.occupancy ?? "",
        totalLivingArea: row.total_living_area ?? "",
        yearBuilt: row.year_built ?? "",
      } as TransferRow;
    },
  }) as TransferRow[];

  return { rows, newestTransfer };
}

/**
 * Convert inventory transfers into the same SaleRecord shape the sales export
 * produces, so both sources share one collection, one dedup key and one
 * geocoding path. Price and seller are unknowable here and left empty.
 */
export function toSaleRecordsFromTransfers(
  rows: TransferRow[],
  fetchYear: number,
  defaultCity: string
): SaleRecord[] {
  const results: SaleRecord[] = [];
  for (const row of rows) {
    const transferred = parseSaleDate(row.transferDate);
    if (!transferred) continue;

    results.push({
      address: row.address,
      city: row.city || defaultCity,
      zip: row.zip,
      buyer: row.owner,
      seller: "",
      saleDate: transferred,
      price: 0,
      lat: null,
      lon: null,
      distanceMiles: null,
      residenceType: row.occupancy,
      totalLivingArea: parseInt(row.totalLivingArea, 10) || null,
      yearBuilt: parseInt(row.yearBuilt, 10) || null,
      quality1: "Inventory transfer",
      geocodeStatus: "no_match",
      fetchYear,
      sourceKey: `${row.book}-${row.pg}`,
      source: "inventory",
    });
  }
  return results;
}
