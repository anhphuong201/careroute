import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, toCsv } from "./csv";
import { haversineKm, inGeometry } from "./geo";
import { mapAhs, mapBc, parseAhsWait } from "../../scripts/refresh-er-waits";

const boundaries = JSON.parse(readFileSync(path.join(__dirname, "../../data/boundaries/ab_bc.geojson"), "utf8"));
const geom = (code: string) => boundaries.features.find((f: { properties: { code: string } }) => f.properties.code === code).geometry;

describe("csv", () => {
  it("round-trips quotes, commas and newlines", () => {
    const rows = [{ a: 'He said "hi"', b: "x,y", c: "line1\nline2" }];
    expect(parseCsv(toCsv(["a", "b", "c"], rows))).toEqual(rows);
  });
});

describe("geo", () => {
  it("computes Calgary → Edmonton ≈ 280 km", () => {
    expect(haversineKm(51.0447, -114.0719, 53.5461, -113.4938)).toBeGreaterThan(270);
    expect(haversineKm(51.0447, -114.0719, 53.5461, -113.4938)).toBeLessThan(290);
  });
  it("puts cities in the right province", () => {
    expect(inGeometry(51.0447, -114.0719, geom("AB"))).toBe(true); // Calgary
    expect(inGeometry(53.5461, -113.4938, geom("AB"))).toBe(true); // Edmonton
    expect(inGeometry(49.888, -119.496, geom("BC"))).toBe(true); // Kelowna
    expect(inGeometry(49.888, -119.496, geom("AB"))).toBe(false);
    expect(inGeometry(47.6062, -122.3321, geom("BC"))).toBe(false); // Seattle
  });
});

describe("ER wait feeds", () => {
  it("parses AHS wait strings", () => {
    expect(parseAhsWait("5 hr 48 min")).toBe(348);
    expect(parseAhsWait("0 hr 30 min")).toBe(30);
    expect(parseAhsWait("")).toBeNull();
  });
  it("maps an AHS site", () => {
    const [s] = mapAhs({
      Calgary: {
        Urgent: [
          {
            Name: "Test UCC", Category: "Urgent Care", WaitTime: "2 hr 20 min", URL: "u", Note: "Open 24 hours<br />Adults",
            TimesUnavailable: "False", Address: "a", GoogleMapsLinkDirection: "https://x/?api=1&query=51.28,-114.01", SiteId: "abc",
          },
        ],
      },
    });
    expect(s).toMatchObject({ id: "ab-er-abc", category: "urgent_care", wait_minutes: 140, lat: 51.28, lng: -114.01, note: "Open 24 hours · Adults" });
  });
  it("hides BC wait when the site does not publish one", () => {
    const [s] = mapBc([
      { id: "1", name: "UPCC", status: "published", type: "upcc", address: "1 St, Vancouver, BC, V1V 1V1", latitude: 49, longitude: -123,
        website: "", audience: "allAges", description: "", showWaitTimes: false, waitTime: { waitTimeMinutes: 99 } },
    ]);
    expect(s).toMatchObject({ category: "urgent_care", wait_minutes: null, city: "Vancouver", audience: "All ages" });
  });
});

describe("shipped data files", () => {
  for (const prov of ["ab", "bc"]) {
    it(`${prov}: rules all have a source_url`, () => {
      const dir = path.join(__dirname, "../../rules", prov);
      for (const f of require("node:fs").readdirSync(dir)) {
        expect(readFileSync(path.join(dir, f), "utf8")).toMatch(/^source_url: https:\/\//m);
      }
    });
  }
});
