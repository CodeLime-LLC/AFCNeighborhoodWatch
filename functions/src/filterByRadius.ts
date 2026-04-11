import { haversineDistanceMiles } from "./geocode";
import { SaleRecord } from "./types";

/**
 * Filter sale records by distance from a center point.
 * Returns records with distanceMiles populated.
 */
export function filterByRadius(
  records: SaleRecord[],
  centerLat: number,
  centerLon: number,
  radiusMiles: number
): SaleRecord[] {
  return records
    .map((record) => {
      if (record.lat == null || record.lon == null) {
        return record;
      }
      const distance = haversineDistanceMiles(
        centerLat,
        centerLon,
        record.lat,
        record.lon
      );
      return { ...record, distanceMiles: distance };
    })
    .filter(
      (record) =>
        record.distanceMiles !== null && record.distanceMiles <= radiusMiles
    );
}
