"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geocodeAddress = geocodeAddress;
exports.batchGeocode = batchGeocode;
exports.haversineDistanceMiles = haversineDistanceMiles;
const CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CENSUS_BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
async function geocodeAddress(address) {
    const params = new URLSearchParams({
        address,
        benchmark: "Public_AR_Current",
        format: "json",
    });
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(`${CENSUS_GEOCODER_URL}?${params}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            const matches = data?.result?.addressMatches;
            if (!matches || matches.length === 0) {
                return null;
            }
            const match = matches[0];
            return {
                lat: match.coordinates.y,
                lon: match.coordinates.x,
                matchedAddress: match.matchedAddress,
            };
        }
        catch (error) {
            if (attempt === 2) {
                console.error(`Geocoding failed after 3 attempts for: ${address}`, error);
                return null;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
    }
    return null;
}
/**
 * Batch geocode multiple addresses using the Census batch endpoint.
 * Accepts up to 10,000 addresses. Returns a map of id -> GeocodeResult.
 */
async function batchGeocode(addresses) {
    const results = new Map();
    if (addresses.length === 0)
        return results;
    // Build CSV content: id, street, city, state, zip
    // The batch endpoint expects structured fields, not a single address line
    const csvLines = addresses
        .map((a) => {
        // Parse "321 NE 9TH ST, ANKENY, IA 50021" into components
        const parts = a.address.split(",").map((s) => s.trim());
        const street = parts[0] || "";
        const city = parts[1] || "";
        let state = "";
        let zip = "";
        if (parts[2]) {
            const stateZip = parts[2].trim().split(/\s+/);
            state = stateZip[0] || "";
            zip = stateZip[1] || "";
        }
        return `${a.id},${street},${city},${state},${zip}`;
    })
        .join("\n");
    const formData = new FormData();
    formData.append("benchmark", "Public_AR_Current");
    formData.append("addressFile", new Blob([csvLines], { type: "text/csv" }), "addresses.csv");
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            console.log(`Batch geocoding ${addresses.length} addresses (attempt ${attempt + 1})...`);
            const response = await fetch(CENSUS_BATCH_URL, {
                method: "POST",
                body: formData,
            });
            if (!response.ok) {
                throw new Error(`Batch geocode HTTP ${response.status}`);
            }
            const text = await response.text();
            const lines = text.trim().split("\n");
            for (const line of lines) {
                // Parse the CSV response: id, input address, match status, match type, matched address, lon/lat, tigerline id, side
                const parts = parseCSVLine(line);
                if (parts.length < 6)
                    continue;
                const id = parts[0].replace(/"/g, "").trim();
                const matchStatus = parts[2].replace(/"/g, "").trim();
                if (matchStatus === "Match") {
                    const matchedAddress = parts[4].replace(/"/g, "").trim();
                    const coords = parts[5].replace(/"/g, "").trim().split(",");
                    if (coords.length === 2) {
                        const lon = parseFloat(coords[0]);
                        const lat = parseFloat(coords[1]);
                        if (!isNaN(lat) && !isNaN(lon)) {
                            results.set(id, { lat, lon, matchedAddress });
                        }
                    }
                }
            }
            console.log(`Batch geocoding complete: ${results.size}/${addresses.length} matched`);
            return results;
        }
        catch (error) {
            if (attempt === 2) {
                console.error("Batch geocoding failed after 3 attempts:", error);
                return results;
            }
            console.warn(`Batch geocode attempt ${attempt + 1} failed, retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
        }
    }
    return results;
}
/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCSVLine(line) {
    const parts = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
            current += char;
        }
        else if (char === "," && !inQuotes) {
            parts.push(current);
            current = "";
        }
        else {
            current += char;
        }
    }
    parts.push(current);
    return parts;
}
/**
 * Haversine formula: calculate distance in miles between two lat/lon points.
 */
function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth's radius in miles
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function toRad(deg) {
    return (deg * Math.PI) / 180;
}
//# sourceMappingURL=geocode.js.map