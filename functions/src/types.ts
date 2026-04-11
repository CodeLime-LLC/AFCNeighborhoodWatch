export interface ChurchConfig {
  churchName: string;
  address: string;
  lat: number;
  lon: number;
  radiusMiles: number;
  timeframeMonths: number;
  jurisdictionCode: string;
  lastFetchDate?: FirebaseFirestore.Timestamp;
  lastFetchStatus?: "success" | "error";
  lastFetchCount?: number;
}

export interface RawSaleRow {
  sale_date: string;
  price: string;
  address: string;
  zip: string;
  buyer: string;
  seller: string;
  quality1: string;
  book: string;
  pg: string;
  occupancy: string;
  residence_type: string;
  total_living_area: string;
  year_built: string;
}

export interface SaleRecord {
  address: string;
  city: string;
  zip: string;
  buyer: string;
  seller: string;
  saleDate: Date;
  price: number;
  lat: number | null;
  lon: number | null;
  distanceMiles: number | null;
  residenceType: string;
  totalLivingArea: number | null;
  yearBuilt: number | null;
  quality1: string;
  geocodeStatus: "matched" | "no_match";
  fetchYear: number;
  sourceKey: string;
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  matchedAddress: string;
}

export interface ProcessResult {
  newRecords: number;
  totalInRadius: number;
  errors: number;
}
