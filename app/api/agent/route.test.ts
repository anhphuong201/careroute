import { describe, expect, it, vi } from "vitest";

const seen: unknown[] = [];
vi.mock("@/lib/agent/runAgent", () => ({ runAgent: async (input: unknown) => (seen.push(input), { type: "error", message: "stub" }) }));
const { POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://x/api/agent", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/agent allow-lists", () => {
  it("keeps only allowed structured answers", async () => {
    await post({
      province: "AB",
      text: "refill",
      ageMonths: 7.6,
      intake: { trend: "worse", severity: "extreme", duration: "1_3_days" },
      profile: { coverage: "no_coverage", higherRisk: "diabetes", preferredMode: "virtual" },
      facts: { runs_out_when: "within_3_days", is_controlled_drug: "maybe", bogus: "x", medication_name: "<script>x</script>" },
      followUps: [
        { fact_id: "runs_out_when", likely_route: "pharmacist" },
        { fact_id: "runs_out_when", likely_route: "pharmacist" },
        { fact_id: "nope", likely_route: "pharmacist" },
        { fact_id: "medication_name", likely_route: "hospital" },
        { fact_id: "is_controlled_drug", likely_route: "pharmacist" },
      ],
    });
    const input = seen.at(-1) as Record<string, unknown>;
    expect(input.ageMonths).toBe(7);
    expect(input.intake).toEqual({ trend: "worse", severity: undefined, duration: "1_3_days" });
    // higherRisk stores only yes/no/prefer_not – never a condition name.
    expect(input.profile).toEqual({ coverage: "no_coverage", higherRisk: undefined, preferredMode: "virtual" });
    expect(input.facts).toEqual({ runs_out_when: "within_3_days", medication_name: "script x /script" });
    expect(input.followUps).toEqual([
      { fact_id: "runs_out_when", likely_route: "pharmacist" },
      { fact_id: "medication_name", likely_route: "call_811" },
    ]);
  });
  it("accepts a numeric string age and rejects anything non-numeric with 400", async () => {
    const before = seen.length;
    const ok = await post({ province: "AB", text: "x", ageMonths: "2" });
    expect(ok.status).toBe(200);
    expect((seen.at(-1) as Record<string, unknown>).ageMonths).toBe(2);
    for (const bad of ["two", "2 months", -3, "-1", true, {}, [2], 99999, "NaN"]) {
      const res = await post({ province: "AB", text: "x", ageMonths: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(await res.json()).toEqual({ type: "error", message: "bad_age" });
    }
    expect(seen.length).toBe(before + 1); // the agent never ran for a bad age
    // Missing age stays "unknown".
    for (const none of [undefined, null, ""]) {
      expect((await post({ province: "AB", text: "x", ageMonths: none })).status).toBe(200);
      expect((seen.at(-1) as Record<string, unknown>).ageMonths).toBeUndefined();
    }
  });
});
