import { describe, it, expect } from "vitest";
import {
  buildReportHtml,
  buildReportText,
  buildReportSubject,
  isSourceStale,
  STALE_AFTER_DAYS,
  ReportContext,
  ReportSale,
} from "../src/email";
import { maxSaleDate, parseSaleDate } from "../src/fetchSales";
import { RawSaleRow } from "../src/types";

function sale(overrides: Partial<ReportSale> = {}): ReportSale {
  return {
    buyer: "SMITH, ROBERT J",
    address: "456 SW MAPLE LN",
    city: "ANKENY",
    zip: "50023",
    distanceMiles: 1.4,
    saleDate: new Date(Date.UTC(2026, 6, 22)),
    ...overrides,
  };
}

function ctx(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    radiusMiles: 3,
    since: new Date("2026-08-24T11:00:00Z"),
    source: { newestSaleDate: new Date(Date.UTC(2026, 7, 20)), lastUpdated: null, stale: false },
    ...overrides,
  };
}

function row(sale_date: string, quality1 = "Arms Length"): RawSaleRow {
  return {
    sale_date, quality1, price: "1", address: "a", zip: "50023", buyer: "b",
    seller: "s", book: "1", pg: "2", occupancy: "", residence_type: "",
    total_living_area: "", year_built: "",
  };
}

describe("isSourceStale", () => {
  const now = new Date("2026-08-31T12:00:00Z");

  it("treats a recently published sale as healthy", () => {
    expect(isSourceStale(new Date("2026-08-25T00:00:00Z"), now)).toBe(false);
  });

  it("flags a feed with nothing newer than the threshold", () => {
    expect(isSourceStale(new Date("2026-07-28T00:00:00Z"), now)).toBe(true);
  });

  it("does not flag exactly at the threshold", () => {
    const edge = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000);
    expect(isSourceStale(edge, now)).toBe(false);
  });

  it("flags one day past the threshold", () => {
    const past = new Date(now.getTime() - (STALE_AFTER_DAYS + 1) * 86_400_000 - 1000);
    expect(isSourceStale(past, now)).toBe(true);
  });

  it("treats an unknown newest sale date as stale", () => {
    expect(isSourceStale(null, now)).toBe(true);
  });
});

describe("maxSaleDate", () => {
  it("finds the newest sale date across rows", () => {
    const d = maxSaleDate([row("2026-03-15"), row("2026-07-28"), row("2026-05-02")]);
    expect(d?.getTime()).toBe(parseSaleDate("2026-07-28")?.getTime());
  });

  it("ignores quality so staleness reflects the whole export", () => {
    const d = maxSaleDate([row("2026-03-15"), row("2026-07-28", "Vacant Lot")]);
    expect(d?.getTime()).toBe(parseSaleDate("2026-07-28")?.getTime());
  });

  it("returns null when no row carries a usable date", () => {
    expect(maxSaleDate([row(""), row("not-a-date")])).toBeNull();
  });
});

describe("report content", () => {
  it("frames the list by discovery date, not sale-date window", () => {
    const html = buildReportHtml([sale()], ctx());
    expect(html).toContain("found since");
    expect(html).toContain("Aug 24, 2026");
    expect(html).not.toContain("in the last");
  });

  it("renders sale dates in UTC so they do not shift a day back", () => {
    // Stored as midnight UTC standing for Jul 22; Central would render Jul 21.
    const html = buildReportHtml([sale()], ctx());
    expect(html).toContain("Jul 22, 2026");
    expect(buildReportText([sale()], ctx())).toContain("Jul 22, 2026");
  });

  it("omits the since-clause on the very first report", () => {
    const html = buildReportHtml([sale()], ctx({ since: null }));
    expect(html).not.toContain("found since");
  });

  it("warns when the county feed has stalled", () => {
    const stale = ctx({
      source: {
        newestSaleDate: new Date(Date.UTC(2026, 6, 28)),
        lastUpdated: new Date("2026-08-19T03:35:00Z"),
        stale: true,
      },
    });
    const html = buildReportHtml([], stale);
    const text = buildReportText([], stale);
    for (const out of [html, text]) {
      expect(out).toMatch(/stalled/i);
      expect(out).toContain("Jul 28, 2026");
      expect(out).toMatch(/Aug 18, 2026/); // Last-Modified shown in Central
    }
  });

  it("does not warn when the feed is healthy", () => {
    expect(buildReportHtml([sale()], ctx())).not.toMatch(/stalled/i);
    expect(buildReportText([sale()], ctx())).not.toMatch(/stalled/i);
  });

  it("distinguishes an empty week from a stalled feed", () => {
    expect(buildReportText([], ctx())).toContain("No new movers found since the last report");
    expect(buildReportText([], ctx({
      source: { newestSaleDate: new Date(Date.UTC(2026, 6, 28)), lastUpdated: null, stale: true },
    }))).toContain("while the county's records are stalled");
  });

  it("counts movers in the summary line", () => {
    expect(buildReportText([sale(), sale()], ctx())).toContain("2 new movers");
    expect(buildReportText([sale()], ctx())).toContain("1 new mover ");
  });
});

describe("buildReportSubject", () => {
  it("calls out a delayed feed when there is nothing to report", () => {
    const s = buildReportSubject([], ctx({
      source: { newestSaleDate: null, lastUpdated: null, stale: true },
    }));
    expect(s).toContain("county data delayed");
  });

  it("uses the normal subject when there are movers, even if stale", () => {
    const s = buildReportSubject([sale()], ctx({
      source: { newestSaleDate: null, lastUpdated: null, stale: true },
    }));
    expect(s).not.toContain("county data delayed");
    expect(s).toContain("New Movers Report");
  });
});
