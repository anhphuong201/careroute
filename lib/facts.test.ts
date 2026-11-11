import { describe, expect, it } from "vitest";
import { FACTS, FACT_IDS, isFactId, knownFacts, missingDecisiveFacts, validateFactAnswer, validateFactAnswers } from "./facts";
import { getRule, parseRule } from "./tools/careRules";
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

describe("required_facts front-matter", () => {
  const rule = (extra: string) => `---\nid: x-test\nprovince: AB\nroute: pharmacist\nneeds: [prescription_renewal]\n${extra}source_url: https://example.org\nstatus: draft\n---\n# Title\n- body\n`;
  it("parses the optional list and defaults to none", () => {
    expect(parseRule(rule("required_facts: [medication_name, runs_out_when]\n")).required_facts).toEqual(["medication_name", "runs_out_when"]);
    expect(parseRule(rule("")).required_facts).toEqual([]);
  });
  it("rejects a fact id that is not in the registry", () => {
    expect(() => parseRule(rule("required_facts: [shoe_size]\n"))).toThrow(/unknown fact id/);
  });
  it("the shipped rules list the expected decisive facts", () => {
    for (const p of ["AB", "BC"] as const) {
      const dir = p.toLowerCase();
      expect(getRule(p, `${dir}-pharmacist`)!.required_facts).toEqual(expect.arrayContaining(["medication_name", "runs_out_when", "is_controlled_drug"]));
      expect(getRule(p, `${dir}-family-doctor`)!.required_facts).toEqual(["lab_ordered_by", "lab_flagged_abnormal"]);
      expect(getRule(p, `${dir}-811`)!.required_facts).toEqual([]);
    }
  });
  it("only renewal/lab facts are enforced, and only for the matching need", () => {
    const facts = getRule("AB", "ab-pharmacist")!.required_facts;
    expect(missingDecisiveFacts(facts, "prescription_renewal", new Set(["medication_name"]))).toEqual(["runs_out_when", "is_controlled_drug"]);
    expect(missingDecisiveFacts(facts, "minor_symptom", new Set())).toEqual([]);
  });
});

describe("en/fr strings for every follow-up and intake answer", () => {
  it("has a question and a label for every answer (except the shared 'not sure')", async () => {
    const { STRINGS } = await import("./i18n");
    const intake = await import("./intake");
    for (const t of Object.values(STRINGS)) {
      expect(t.notSure).toBeTruthy();
      for (const id of FACT_IDS) {
        expect(t.facts[id]?.q, id).toBeTruthy();
        for (const o of FACTS[id].options) if (o !== "not_sure" && FACTS[id].type === "choice") expect(t.facts[id].a[o], `${id}.${o}`).toBeTruthy();
      }
      for (const v of intake.TRENDS) expect(t.trends[v]).toBeTruthy();
      for (const v of intake.SEVERITIES) expect(t.severities[v]).toBeTruthy();
      for (const v of intake.DURATIONS) expect(t.durationBuckets[v]).toBeTruthy();
      for (const v of intake.COVERAGES) expect(t.coverages[v]).toBeTruthy();
      for (const v of intake.HIGHER_RISK) expect(t.higherRisks[v]).toBeTruthy();
      for (const v of intake.PREFERRED_MODES) expect(t.preferredModes[v]).toBeTruthy();
    }
  });
});
