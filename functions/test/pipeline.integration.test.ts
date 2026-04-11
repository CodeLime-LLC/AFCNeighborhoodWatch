import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseCsv,
  filterByDateAndQuality,
  toSaleRecords,
  dedup,
} from "../src/fetchSales";
import { haversineDistanceMiles } from "../src/geocode";

const sampleCsv = readFileSync(
  join(__dirname, "fixtures/sample-sales.csv"),
  "utf-8"
);

// Church coordinates (118 NW Linden St, Ankeny, IA 50023)
const CHURCH_LAT = 41.7295;
const CHURCH_LON = -93.6058;

// Mock geocode results for our test addresses
const GEOCODE_RESULTS: Record<string, { lat: number; lon: number }> = {
  "321 NE 9TH ST, ANKENY, IA 50021": { lat: 41.7386, lon: -93.5966 },
  "456 SW MAPLE LN, ANKENY, IA 50023": { lat: 41.725, lon: -93.61 },
  "789 NW ELM DR, ANKENY, IA 50021": { lat: 41.735, lon: -93.59 },
  "222 NW CHERRY CT, ANKENY, IA 50023": { lat: 41.728, lon: -93.608 },
  "333 SE PINE RD, ANKENY, IA 50021": { lat: 41.72, lon: -93.58 },
};

describe("Full Pipeline Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("processes CSV through full pipeline: parse → filter → dedup → geocode → distance", async () => {
    // Step 1: Parse
    const rows = parseCsv(sampleCsv);
    expect(rows).toHaveLength(6);

    // Step 2: Filter (cutoff: Feb 1, 2026)
    const cutoff = new Date(2026, 1, 1);
    const filtered = filterByDateAndQuality(rows, cutoff);
    expect(filtered).toHaveLength(4); // 4 Arms Length sales after Feb 1

    // Step 3: Convert to records
    const records = toSaleRecords(filtered, 2026);
    expect(records).toHaveLength(4);

    // Step 4: Dedup (simulate one existing record)
    const existingKeys = new Set(["20473-496"]); // First record already exists
    const newRecords = dedup(records, existingKeys);
    expect(newRecords).toHaveLength(3);

    // Step 5: Geocode (mock) + distance
    for (const record of newRecords) {
      const fullAddress = `${record.address}, ${record.city}, IA ${record.zip}`;
      const coords = GEOCODE_RESULTS[fullAddress];
      if (coords) {
        record.lat = coords.lat;
        record.lon = coords.lon;
        record.geocodeStatus = "matched";
        record.distanceMiles = haversineDistanceMiles(
          CHURCH_LAT,
          CHURCH_LON,
          coords.lat,
          coords.lon
        );
      }
    }

    // Verify results
    const geocoded = newRecords.filter((r) => r.geocodeStatus === "matched");
    expect(geocoded.length).toBeGreaterThan(0);

    // All geocoded records should have valid distances
    for (const record of geocoded) {
      expect(record.lat).not.toBeNull();
      expect(record.lon).not.toBeNull();
      expect(record.distanceMiles).not.toBeNull();
      expect(record.distanceMiles!).toBeGreaterThanOrEqual(0);
    }

    // Check that records within 3 miles exist
    const withinRadius = geocoded.filter(
      (r) => r.distanceMiles! <= 3
    );
    expect(withinRadius.length).toBeGreaterThan(0);

    // Verify the data integrity of a specific record
    const mapleRecord = newRecords.find((r) =>
      r.address.includes("MAPLE")
    );
    expect(mapleRecord).toBeDefined();
    expect(mapleRecord!.buyer).toBe("JOHNSON, SARAH M");
    expect(mapleRecord!.price).toBe(350000);
    expect(mapleRecord!.saleDate).toEqual(new Date(2026, 2, 10));
  });

  it("handles empty CSV gracefully", () => {
    const emptyCsv = "sale_date,price,address,zip,buyer,seller,quality1,book,pg,residence_type,total_living_area,year_built\n";
    const rows = parseCsv(emptyCsv);
    expect(rows).toHaveLength(0);

    const filtered = filterByDateAndQuality(rows, new Date(2020, 0, 1));
    expect(filtered).toHaveLength(0);
  });

  it("correctly deduplicates across multiple CSV fetches", () => {
    // Simulate fetching same CSV twice
    const rows1 = parseCsv(sampleCsv);
    const records1 = toSaleRecords(rows1, 2026);

    // First batch: all new
    const batch1 = dedup(records1, new Set());
    expect(batch1).toHaveLength(6);

    // Second batch: all duplicates
    const existingKeys = new Set(batch1.map((r) => r.sourceKey));
    const rows2 = parseCsv(sampleCsv);
    const records2 = toSaleRecords(rows2, 2026);
    const batch2 = dedup(records2, existingKeys);
    expect(batch2).toHaveLength(0);
  });
});
