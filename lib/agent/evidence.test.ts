import { describe, expect, it } from "vitest";
import { evidenceSupported } from "./evidence";

const RULE = "Prescription renewal of a medicine the person already takes. All Alberta pharmacists can renew most existing prescriptions, and change the dose, form or length.";

describe("evidenceSupported", () => {
  it("accepts an exact or lightly re-punctuated quote", () => {
    expect(evidenceSupported("All Alberta pharmacists can renew most existing prescriptions", RULE)).toBe(true);
    expect(evidenceSupported("all alberta pharmacists can renew most existing prescriptions, and change the dose", RULE)).toBe(true);
  });
  it("rejects invented or too-short quotes", () => {
    expect(evidenceSupported("Pharmacists can treat every problem", RULE)).toBe(false);
    expect(evidenceSupported("renew", RULE)).toBe(false);
    expect(evidenceSupported("", RULE)).toBe(false);
  });
});
