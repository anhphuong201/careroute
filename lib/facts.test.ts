import { describe, expect, it } from "vitest";
import { FACTS, FACT_IDS, isFactId, knownFacts, validateFactAnswer, validateFactAnswers } from "./facts";
import { ageGroupFromMonths, monthsFromBirthDate, needsEscalation } from "./intake";

describe("fact registry", () => {
  it("defines every id once, and every choice fact allows 'not sure'", () => {
    expect(Object.keys(FACTS).sort()).toEqual([...FACT_IDS].sort());
    for (const id of FACT_IDS) {
      expect(FACTS[id].id).toBe(id);
      expect(FACTS[id].options).toContain("not_sure");
    }
  });
  it("validates choice answers against the allow-list", () => {
    expect(validateFactAnswer("runs_out_when", "within_3_days")).toBe("within_3_days");
    expect(validateFactAnswer("runs_out_when", "tomorrow")).toBeNull();
    expect(validateFactAnswer("is_controlled_drug", "not_sure")).toBe("not_sure");
    expect(validateFactAnswer("is_controlled_drug", 1)).toBeNull();
  });
  it("cleans free-text answers and caps their length", () => {
    expect(validateFactAnswer("medication_name", "  Synthroid <b>50</b>\n")).toBe("Synthroid b 50 /b");
    expect(validateFactAnswer("medication_name", "x".repeat(200))).toHaveLength(60);
    expect(validateFactAnswer("medication_name", "   ")).toBeNull();
  });
  it("drops unknown keys and bad values from an answers object", () => {
    expect(validateFactAnswers({ runs_out_when: "already_out", bogus: "x", lab_ordered_by: "my cousin" })).toEqual({ runs_out_when: "already_out" });
    expect(validateFactAnswers(null)).toEqual({});
  });
  it("treats answered facts (even 'not sure') and facts stated in text as known", () => {
    const k = knownFacts({ medication_name: "not_sure" }, ["runs_out_when", "made_up"]);
    expect([...k].sort()).toEqual(["medication_name", "runs_out_when"]);
    expect(isFactId("made_up")).toBe(false);
  });
});

describe("intake helpers", () => {
  it("derives exact months and the legacy age group", () => {
    const now = new Date(2026, 10, 11);
    expect(monthsFromBirthDate("2026-09-01", now)).toBe(2);
    expect(monthsFromBirthDate("2030-01-01", now)).toBeNull();
    expect(ageGroupFromMonths(2)).toBe("infant");
    expect(ageGroupFromMonths(30)).toBe("child");
    expect(ageGroupFromMonths(18 * 12)).toBe("adult");
    expect(ageGroupFromMonths(undefined, "child")).toBe("child");
  });
  it("escalates only when severe AND getting worse", () => {
    expect(needsEscalation({ severity: "severe", trend: "worse" })).toBe(true);
    expect(needsEscalation({ severity: "severe", trend: "same" })).toBe(false);
    expect(needsEscalation({ severity: "moderate", trend: "worse" })).toBe(false);
  });
});
