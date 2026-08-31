import { describe, it, expect } from "vitest";
import {
  parseTransfers,
  toSaleRecordsFromTransfers,
  looksLikeEntity,
  isOwnerOccupied,
} from "../src/fetchTransfers";

const COLS = [
  "address_line1", "house", "street", "city", "zip", "occupancy",
  "total_living_area", "year_built", "title_holder1", "transfer_th1",
  "book_th1", "pg_th1", "mail_house", "mail_street", "mail_zip",
];

function csv(rows: Record<string, string>[]): string {
  const line = (r: Record<string, string>) =>
    COLS.map((c) => r[c] ?? "").join(",");
  return [COLS.join(","), ...rows.map(line)].join("\n") + "\n";
}

function transfer(over: Record<string, string> = {}): Record<string, string> {
  return {
    address_line1: "1014 NE TRILEIN DR", house: "1014", street: "TRILEIN",
    city: "ANKENY", zip: "50021", occupancy: "Single Family",
    total_living_area: "1450", year_built: "2005",
    title_holder1: "NICKOLAS WILSON", transfer_th1: "2026-08-20",
    book_th1: "20631", pg_th1: "250",
    mail_house: "1014", mail_street: "TRILEIN", mail_zip: "50021",
    ...over,
  };
}

const CUTOFF = new Date(2026, 6, 1); // Jul 1 2026

describe("looksLikeEntity", () => {
  it("passes an individual through", () => {
    expect(looksLikeEntity("NICKOLAS WILSON")).toBe(false);
    expect(looksLikeEntity("MARY JOY NORTON")).toBe(false);
  });

  it("catches the obvious organisations", () => {
    for (const n of [
      "RICHARD ROY ROGERS FAMILY TRUST",
      "LARDOG PROPERTIES LLC",
      "FIRST NATIONAL BANK",
    ]) {
      expect(looksLikeEntity(n)).toBe(true);
    }
  });

  it("catches investor names that read like a person", () => {
    // Slipped the original filter during the Aug 2026 catch-up.
    expect(looksLikeEntity("DRIVEN HOLDINGS")).toBe(true);
    expect(looksLikeEntity("SUMMIT VENTURES")).toBe(true);
  });

  it("does not fire on a name that merely contains a marker's letters", () => {
    expect(looksLikeEntity("VINCENT INGRAM")).toBe(false); // 'INC' inside a word
    expect(looksLikeEntity("TRUSTIN HALE")).toBe(false);
  });
});

describe("isOwnerOccupied", () => {
  it("accepts an owner whose mail matches the property", () => {
    expect(isOwnerOccupied(transfer())).toBe(true);
  });

  it("rejects an owner who is mailed elsewhere", () => {
    expect(isOwnerOccupied(transfer({ mail_house: "2403", mail_street: "COMSTOCK" }))).toBe(false);
  });

  it("ignores case and padding", () => {
    expect(isOwnerOccupied(transfer({ mail_street: " trilein " }))).toBe(true);
  });
});

describe("parseTransfers", () => {
  it("keeps a recent owner-occupied residential transfer", () => {
    const { rows } = parseTransfers(csv([transfer()]), CUTOFF);
    expect(rows).toHaveLength(1);
    expect(rows[0].owner).toBe("NICKOLAS WILSON");
    expect(rows[0].book).toBe("20631");
  });

  it("keeps condos and townhouses, not just detached houses", () => {
    const { rows } = parseTransfers(
      csv([
        transfer({ occupancy: "Condominium", pg_th1: "1" }),
        transfer({ occupancy: "Townhouse", pg_th1: "2" }),
        transfer({ occupancy: "Bi-attached", pg_th1: "3" }),
      ]),
      CUTOFF
    );
    expect(rows).toHaveLength(3);
  });

  it("drops non-dwellings, landlords, entities and stale transfers", () => {
    const { rows } = parseTransfers(
      csv([
        transfer({ occupancy: "", pg_th1: "1" }),
        transfer({ mail_house: "999", mail_street: "ELSEWHERE", pg_th1: "2" }),
        transfer({ title_holder1: "LARDOG PROPERTIES LLC", pg_th1: "3" }),
        transfer({ transfer_th1: "2021-10-15", pg_th1: "4" }),
        transfer({ book_th1: "", pg_th1: "5" }),
      ]),
      CUTOFF
    );
    expect(rows).toHaveLength(0);
  });

  it("reports the newest transfer even when that row is filtered out", () => {
    // Freshness describes the export, not the subset we keep.
    const { rows, newestTransfer } = parseTransfers(
      csv([
        transfer({ transfer_th1: "2026-08-02" }),
        transfer({ transfer_th1: "2026-08-25", title_holder1: "BIG BANK", pg_th1: "9" }),
      ]),
      CUTOFF
    );
    expect(rows).toHaveLength(1);
    expect(newestTransfer?.getFullYear()).toBe(2026);
    expect(newestTransfer?.getMonth()).toBe(7);
    expect(newestTransfer?.getDate()).toBe(25);
  });

  it("returns a null newest transfer for an empty export", () => {
    expect(parseTransfers(csv([]), CUTOFF).newestTransfer).toBeNull();
  });
});

describe("toSaleRecordsFromTransfers", () => {
  it("maps onto the shared SaleRecord shape and deed key", () => {
    const { rows } = parseTransfers(csv([transfer()]), CUTOFF);
    const [r] = toSaleRecordsFromTransfers(rows, 2026, "ANKENY");
    expect(r.sourceKey).toBe("20631-250");   // same key space as the sales export
    expect(r.source).toBe("inventory");
    expect(r.buyer).toBe("NICKOLAS WILSON");
    expect(r.price).toBe(0);                 // no price in this export
    expect(r.seller).toBe("");
    expect(r.quality1).toBe("Inventory transfer");
    expect(r.totalLivingArea).toBe(1450);
    expect(r.saleDate.getMonth()).toBe(7);
  });

  it("falls back to the default city when the row has none", () => {
    const { rows } = parseTransfers(csv([transfer({ city: "" })]), CUTOFF);
    expect(toSaleRecordsFromTransfers(rows, 2026, "ANKENY")[0].city).toBe("ANKENY");
  });
});
