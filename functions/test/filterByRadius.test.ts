import { describe, it, expect } from "vitest";
import { filterByRadius } from "../src/filterByRadius";
import { SaleRecord } from "../src/types";

function makeSale(lat: number | null, lon: number | null): SaleRecord {
  return {
    address: "123 TEST ST",
    city: "ANKENY",
    zip: "50023",
    buyer: "TEST BUYER",
    seller: "TEST SELLER",
    saleDate: new Date(2026, 2, 15),
    price: 250000,
    lat,
    lon,
    distanceMiles: null,
    residenceType: "Single Family",
    totalLivingArea: 1200,
    yearBuilt: 2000,
    quality1: "Arms Length",
    geocodeStatus: lat ? "matched" : "no_match",
    fetchYear: 2026,
    sourceKey: `${Math.random()}`,
  };
}

// Church location: 118 NW Linden St, Ankeny, IA 50023
const CHURCH_LAT = 41.7295;
const CHURCH_LON = -93.6058;

describe("filterByRadius", () => {
  it("includes records within radius", () => {
    // A point very close to the church (~0.1 miles)
    const records = [makeSale(41.73, -93.606)];
    const result = filterByRadius(records, CHURCH_LAT, CHURCH_LON, 3);
    expect(result).toHaveLength(1);
    expect(result[0].distanceMiles).toBeDefined();
    expect(result[0].distanceMiles!).toBeLessThan(1);
  });

  it("excludes records outside radius", () => {
    // Des Moines downtown (~10 miles away)
    const records = [makeSale(41.5868, -93.625)];
    const result = filterByRadius(records, CHURCH_LAT, CHURCH_LON, 3);
    expect(result).toHaveLength(0);
  });

  it("includes records just inside the radius boundary", () => {
    // ~2.9 miles north (2.9/69 degrees latitude)
    const nearBoundary = CHURCH_LAT + 2.9 / 69;
    const records = [makeSale(nearBoundary, CHURCH_LON)];
    const result = filterByRadius(records, CHURCH_LAT, CHURCH_LON, 3);
    expect(result).toHaveLength(1);
    expect(result[0].distanceMiles!).toBeLessThan(3);
    expect(result[0].distanceMiles!).toBeGreaterThan(2.5);
  });

  it("excludes records with null coordinates", () => {
    const records = [makeSale(null, null)];
    const result = filterByRadius(records, CHURCH_LAT, CHURCH_LON, 3);
    expect(result).toHaveLength(0);
  });

  it("handles zero radius (only exact location)", () => {
    const records = [makeSale(CHURCH_LAT, CHURCH_LON)];
    const result = filterByRadius(records, CHURCH_LAT, CHURCH_LON, 0);
    // Same point = 0 distance, should be included with radius 0
    expect(result).toHaveLength(1);
    expect(result[0].distanceMiles!).toBeCloseTo(0, 5);
  });

  it("handles mixed records (some in, some out)", () => {
    const records = [
      makeSale(41.73, -93.606), // close (~0.1 mi)
      makeSale(41.5868, -93.625), // far (~10 mi)
      makeSale(41.735, -93.61), // medium (~0.5 mi)
      makeSale(null, null), // no coords
    ];
    const result = filterByRadius(records, CHURCH_LAT, CHURCH_LON, 3);
    expect(result).toHaveLength(2);
  });

  it("populates distanceMiles on returned records", () => {
    const records = [makeSale(41.73, -93.606)];
    const result = filterByRadius(records, CHURCH_LAT, CHURCH_LON, 10);
    expect(result[0].distanceMiles).toBeGreaterThanOrEqual(0);
    expect(typeof result[0].distanceMiles).toBe("number");
  });
});
