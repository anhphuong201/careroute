import { describe, expect, it } from "vitest";
import { arriveBy, transitArriveByUrl, uberRideUrl } from "./travel";
import { zonedDate } from "../data/tz";

const TZ = "America/Edmonton";
const place = { name: "Rexall", address: "244-315 8 Avenue SW, T2P 4K1", city: "Calgary", lat: 51.046, lng: -114.069 };

describe("travel links", () => {
  const appt = zonedDate(2026, 11, 10, 9, 30, TZ);
  it("sets transit directions to arrive 15 minutes early, in the province's time", () => {
    const u = new URL(transitArriveByUrl(place, appt, TZ));
    expect(u.searchParams.get("dirflg")).toBe("r");
    expect(u.searchParams.get("ttype")).toBe("arr");
    expect(u.searchParams.get("date")).toBe("11/10/26");
    expect(u.searchParams.get("time")).toBe("9:15am");
    expect(u.searchParams.get("daddr")).toContain("Rexall, 244-315 8 Avenue SW");
    expect(u.searchParams.get("saddr")).toBe("My Location");
    expect(arriveBy(appt).getTime()).toBe(appt.getTime() - 15 * 60000);
  });
  it("uses the shared GPS position as the start when available", () => {
    const u = new URL(transitArriveByUrl(place, appt, TZ, { lat: 51.03, lng: -114.1 }));
    expect(u.searchParams.get("saddr")).toBe("51.03,-114.1");
  });
  it("fills Uber pickup and drop-off; no link without coordinates", () => {
    const u = new URL(uberRideUrl(place)!);
    expect(u.searchParams.get("pickup")).toBe("my_location");
    expect(u.searchParams.get("dropoff[latitude]")).toBe("51.046");
    expect(u.searchParams.get("dropoff[nickname]")).toBe("Rexall");
    expect(uberRideUrl({ ...place, lat: null, lng: null })).toBeNull();
  });
});
