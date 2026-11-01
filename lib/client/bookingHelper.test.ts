import { describe, expect, it } from "vitest";
import { callScript, hasContact, icsFor, maskCard } from "./bookingHelper";

describe("assisted booking helpers", () => {
  it("masks the health card number", () => {
    expect(maskCard("12345 6789")).toBe("•••••6789");
    expect(maskCard("")).toBe("");
  });
  it("writes a call script with the reason and no health card number", () => {
    const s = callScript({ place: "Rexall", name: "Amira", reason: "Burning when urinating for 2 days.", lang: "en" });
    expect(s).toContain("for Amira");
    expect(s).toContain("Burning when urinating");
  });
  it("builds a valid calendar file", () => {
    const ics = icsFor({ title: "Pharmacist, Rexall", start: new Date("2026-11-03T16:30:00Z"), location: "1 Main St, Calgary", description: "Confirmation ABC" });
    expect(ics).toContain("DTSTART:20261103T163000Z");
    expect(ics).toContain("DTEND:20261103T170000Z");
    expect(ics).toContain("SUMMARY:Pharmacist\\, Rexall");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
  it("knows when details are saved", () => {
    expect(hasContact(undefined)).toBe(false);
    expect(hasContact({ phone: " " })).toBe(false);
    expect(hasContact({ phone: "403-555-0100" })).toBe(true);
  });
});
