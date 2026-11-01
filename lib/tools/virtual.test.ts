import { describe, expect, it } from "vitest";
import { findFacilities, getFacility } from "./facilities";
import { bookAppointment, validSlot } from "./booking";

describe("virtual care options", () => {
  it("lists official services first, with sources, and needs no location", () => {
    const ab = findFacilities({ province: "AB", kind: "virtual" });
    expect(ab.facilities[0]).toMatchObject({ kind: "virtual", official: true, phone: "811" });
    expect(ab.facilities.length).toBeGreaterThan(1);
    for (const f of ab.facilities) expect(f.source_url).toMatch(/^https:\/\//);
    const bc = findFacilities({ province: "BC", kind: "virtual" });
    expect(bc.facilities[0].limits).toMatch(/refill/i);
  });
  it("can be booked (simulated) by id", () => {
    const f = getFacility("AB", "ab-vc-811-virtual-md")!;
    const b = bookAppointment(f, "Amira");
    expect(b.simulated).toBe(true);
    expect(b.instructions).toMatch(/real life/i);
  });
});

describe("booking slot", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  it("accepts a slot within the next 7 days", () => {
    expect(validSlot("2026-11-03T15:00:00Z", now)).not.toBeNull();
  });
  it("rejects past or far-future slots and falls back to the next free slot", () => {
    expect(validSlot("2026-11-01T15:00:00Z", now)).toBeNull();
    expect(validSlot("2026-12-01T15:00:00Z", now)).toBeNull();
    const f = getFacility("AB", "ab-vc-811-virtual-md")!;
    expect(new Date(bookAppointment(f, "x", now, "1999-01-01").slot).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("walk-in de-duplication", () => {
  it("does not list an OSM clinic on top of the official AHS site", () => {
    const r = findFacilities({ province: "AB", kind: "walk_in", lat: 51.0447, lng: -114.0719, limit: 5 });
    const chumir = r.facilities.filter((f) => /chumir/i.test(f.name));
    expect(chumir).toHaveLength(1);
    expect(chumir[0].kind).toBe("urgent_care");
  });
});

describe("real pharmacy booking links", () => {
  it("adds Rexall's booking page in Alberta and the provincial site in B.C.", async () => {
    const { bookingFor } = await import("../data/pharmacyBooking");
    expect(bookingFor("Rexall", "AB")?.url).toMatch(/^https:\/\/rexall\.medmeapp\.com\//);
    expect(bookingFor("Shoppers Drug Mart", "BC")?.url).toBe("https://bookapharmacist.gov.bc.ca/s/");
    expect(bookingFor("Rexall", "BC")?.url).toMatch(/rexall/);
    expect(bookingFor("Shoppers Drug Mart", "AB")).toBeUndefined();
  });
  it("attaches booking to nearby pharmacies", () => {
    const r = findFacilities({ province: "BC", kind: "pharmacy", lat: 49.2827, lng: -123.1207, limit: 3 });
    expect(r.facilities.every((f) => f.booking?.url)).toBe(true);
  });
});
