import { describe, it, expect, vi, beforeEach } from "vitest";
import { geocodeAddress, haversineDistanceMiles } from "../src/geocode";

describe("haversineDistanceMiles", () => {
  it("calculates zero distance for same point", () => {
    const d = haversineDistanceMiles(41.7318, -93.6001, 41.7318, -93.6001);
    expect(d).toBeCloseTo(0, 5);
  });

  it("calculates known distance between Ankeny and Des Moines", () => {
    // Ankeny: 41.7318, -93.6001
    // Des Moines (downtown): 41.5868, -93.6250
    const d = haversineDistanceMiles(41.7318, -93.6001, 41.5868, -93.625);
    // Should be approximately 10 miles
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(11);
  });

  it("calculates short distance correctly", () => {
    // Two points about 1 mile apart in Ankeny
    // 118 NW Linden St: ~41.7295, -93.6058
    // Ankeny City Hall: ~41.7296, -93.5906
    const d = haversineDistanceMiles(41.7295, -93.6058, 41.7296, -93.5906);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(1.5);
  });

  it("handles points at exactly the same latitude", () => {
    const d = haversineDistanceMiles(41.7318, -93.6001, 41.7318, -93.5001);
    expect(d).toBeGreaterThan(0);
  });

  it("handles points at exactly the same longitude", () => {
    const d = haversineDistanceMiles(41.7318, -93.6001, 41.8318, -93.6001);
    expect(d).toBeGreaterThan(0);
  });
});

describe("geocodeAddress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns lat/lon on successful geocode", async () => {
    const mockResponse = {
      result: {
        addressMatches: [
          {
            coordinates: { x: -93.6058, y: 41.7295 },
            matchedAddress: "118 NW LINDEN ST, ANKENY, IA, 50023",
          },
        ],
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await geocodeAddress("118 NW Linden St, Ankeny, IA 50023");
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(41.7295);
    expect(result!.lon).toBeCloseTo(-93.6058);
    expect(result!.matchedAddress).toBe("118 NW LINDEN ST, ANKENY, IA, 50023");
  });

  it("returns null when no matches found", async () => {
    const mockResponse = {
      result: {
        addressMatches: [],
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await geocodeAddress("Fake Address 12345");
    expect(result).toBeNull();
  });

  it("retries on fetch failure", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch");

    // Fail twice, succeed on third
    mockFetch
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            addressMatches: [
              {
                coordinates: { x: -93.6, y: 41.73 },
                matchedAddress: "TEST ADDRESS",
              },
            ],
          },
        }),
      } as Response);

    const result = await geocodeAddress("Test Address");
    expect(result).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 15000);

  it("returns null after all retries exhausted", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network error")
    );

    const result = await geocodeAddress("Test Address");
    expect(result).toBeNull();
  }, 15000);
});
