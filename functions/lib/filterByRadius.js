"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterByRadius = filterByRadius;
const geocode_1 = require("./geocode");
/**
 * Filter sale records by distance from a center point.
 * Returns records with distanceMiles populated.
 */
function filterByRadius(records, centerLat, centerLon, radiusMiles) {
    return records
        .map((record) => {
        if (record.lat == null || record.lon == null) {
            return record;
        }
        const distance = (0, geocode_1.haversineDistanceMiles)(centerLat, centerLon, record.lat, record.lon);
        return { ...record, distanceMiles: distance };
    })
        .filter((record) => record.distanceMiles !== null && record.distanceMiles <= radiusMiles);
}
//# sourceMappingURL=filterByRadius.js.map