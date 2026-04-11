import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseCsv,
  filterByDateAndQuality,
  toSaleRecords,
  dedup,
  getYearsToFetch,
} from "../src/fetchSales";

const sampleCsv = readFileSync(
  join(__dirname, "fixtures/sample-sales.csv"),
  "utf-8"
);

describe("parseCsv", () => {
  it("parses CSV into raw sale rows", () => {
    const rows = parseCsv(sampleCsv);
    expect(rows).toHaveLength(6);
    expect(rows[0].address).toBe("321 NE 9TH ST");
    expect(rows[0].buyer).toBe("DENNIS, ISAAC ALEXANDER");
    expect(rows[0].price).toBe("285000");
    expect(rows[0].quality1).toBe("Arms Length");
    expect(rows[0].book).toBe("20473");
    expect(rows[0].pg).toBe("496");
  });

  it("handles all fields correctly", () => {
    const rows = parseCsv(sampleCsv);
    const row = rows[1];
    expect(row.sale_date).toBe("2026-03-10");
    expect(row.zip).toBe("50023");
    expect(row.seller).toBe("SMITH, ROBERT J");
    expect(row.residence_type).toBe("1 Story");
    expect(row.total_living_area).toBe("1450");
    expect(row.year_built).toBe("2005");
  });
});

describe("filterByDateAndQuality", () => {
  it("filters to Arms Length sales only", () => {
    const rows = parseCsv(sampleCsv);
    // Use a very old cutoff so all dates pass
    const cutoff = new Date(2020, 0, 1);
    const filtered = filterByDateAndQuality(rows, cutoff);
    expect(filtered).toHaveLength(5); // excludes the Family Transfer
    expect(filtered.every((r) => r.quality1 === "Arms Length")).toBe(true);
  });

  it("filters by date range", () => {
    const rows = parseCsv(sampleCsv);
    // Cutoff of Feb 1, 2026 — should exclude the Dec 2025 and Jan 2026 records
    const cutoff = new Date(2026, 1, 1);
    const filtered = filterByDateAndQuality(rows, cutoff);
    // Should include: 03/15, 03/10, 02/28, 03/01 (all Arms Length and >= Feb 1)
    expect(filtered).toHaveLength(4);
  });

  it("returns empty array when no matches", () => {
    const rows = parseCsv(sampleCsv);
    const futureDate = new Date(2030, 0, 1);
    const filtered = filterByDateAndQuality(rows, futureDate);
    expect(filtered).toHaveLength(0);
  });
});

describe("toSaleRecords", () => {
  it("converts raw rows to SaleRecord objects", () => {
    const rows = parseCsv(sampleCsv);
    const records = toSaleRecords(rows, 2026);

    expect(records).toHaveLength(6);
    const first = records[0];
    expect(first.address).toBe("321 NE 9TH ST");
    expect(first.city).toBe("ANKENY");
    expect(first.buyer).toBe("DENNIS, ISAAC ALEXANDER");
    expect(first.price).toBe(285000);
    expect(first.sourceKey).toBe("20473-496");
    expect(first.fetchYear).toBe(2026);
    expect(first.saleDate).toEqual(new Date(2026, 2, 15));
    expect(first.lat).toBeNull();
    expect(first.lon).toBeNull();
    expect(first.geocodeStatus).toBe("no_match");
  });

  it("handles zero price (family transfer)", () => {
    const rows = parseCsv(sampleCsv);
    const records = toSaleRecords(rows, 2026);
    const familyTransfer = records.find((r) => r.sourceKey === "20476-499");
    expect(familyTransfer?.price).toBe(0);
  });
});

describe("dedup", () => {
  it("removes records with existing source keys", () => {
    const rows = parseCsv(sampleCsv);
    const records = toSaleRecords(rows, 2026);
    const existingKeys = new Set(["20473-496", "20474-497"]);
    const deduped = dedup(records, existingKeys);
    expect(deduped).toHaveLength(4);
    expect(deduped.find((r) => r.sourceKey === "20473-496")).toBeUndefined();
    expect(deduped.find((r) => r.sourceKey === "20474-497")).toBeUndefined();
  });

  it("keeps all records when no existing keys", () => {
    const rows = parseCsv(sampleCsv);
    const records = toSaleRecords(rows, 2026);
    const deduped = dedup(records, new Set());
    expect(deduped).toHaveLength(6);
  });

  it("removes all records when all keys exist", () => {
    const rows = parseCsv(sampleCsv);
    const records = toSaleRecords(rows, 2026);
    const allKeys = new Set(records.map((r) => r.sourceKey));
    const deduped = dedup(records, allKeys);
    expect(deduped).toHaveLength(0);
  });
});

describe("getYearsToFetch", () => {
  it("returns current year for short timeframes", () => {
    const years = getYearsToFetch(1);
    const currentYear = new Date().getFullYear();
    expect(years).toContain(currentYear);
  });

  it("returns two years when timeframe spans year boundary", () => {
    // If we're in January and looking back 2 months, we need prior year
    const years = getYearsToFetch(13); // 13 months always spans a year
    expect(years.length).toBe(2);
  });
});
