import { describe, expect, it } from "vitest";
import { runAgent, type AgentInput } from "./runAgent";
import type { LlmClient, Turn } from "../llm/types";
import { getRule } from "../tools/careRules";

/** A real line from the rule, as the model would quote it. */
const ev = (id: string) => {
  const line = getRule(id.startsWith("ab") ? "AB" : "BC", id)!.body.split("\n").find((l) => /^- .{25,}/.test(l))!;
  return line.slice(2).replace(/\*\*/g, "");
};

type Step = { name: string; input: Record<string, unknown> }[];

/** Fake model: returns one scripted assistant turn per call and records each request's turns. */
function fake(steps: Step[]) {
  const requests: { turns: Turn[]; tools: string[] }[] = [];
  let i = 0;
  const client: LlmClient = {
    provider: "fake",
    model: "fake",
    async complete({ tools, turns }) {
      requests.push({ turns: structuredClone(turns), tools: tools.map((t) => t.name) });
      const calls = steps[i++] ?? [];
      return { text: "", stop: calls.length ? "tool_use" : "end", toolCalls: calls.map((c, j) => ({ id: `tu_${i}_${j}`, name: c.name, input: c.input })) };
    },
  };
  return { client, requests };
}

const CALGARY = { lat: 51.0447, lng: -114.0719 };
/** Core taps answered (required for symptom requests; optional for renewals and labs). */
const SYMPTOM_INTAKE = { severity: "mild", trend: "same", duration: "1_3_days" } as const;
const base: AgentInput = { province: "AB", text: "", ageGroup: "adult", hasFamilyDoctor: "no", location: CALGARY, intake: SYMPTOM_INTAKE };
/** Facts that decide renewal / lab routes, already answered (so these tests are about other behaviour). */
const RENEWAL_FACTS = { medication_name: "Synthroid", runs_out_when: "within_3_days", is_controlled_drug: "no" } as const;
const LAB_FACTS = { lab_ordered_by: "walk_in", lab_flagged_abnormal: "no" } as const;
const NO_DEBUG = { asked: [], route_changed: [] };

describe("runAgent – safety gates", () => {
  it("stops before any model call when the raw text has a red flag", async () => {
    const { client, requests } = fake([]);
    const r = await runAgent({ ...base, text: "I have chest pain" }, client);
    expect(r).toEqual({ type: "emergency", action: "call_911", stage: "input", debug: NO_DEBUG });
    expect(requests).toHaveLength(0);
  });

  it("stops when the checklist says yes, even with harmless text", async () => {
    const { client, requests } = fake([]);
    const r = await runAgent({ ...base, text: "refill", checklist: { suicidal_thoughts: true } }, client);
    expect(r).toMatchObject({ type: "emergency", action: "call_911_or_988" });
    expect(requests).toHaveLength(0);
  });

  it("re-checks the model's English restatement (language the keyword list misses)", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "ko", need_summary_en: "My father has chest pain and is sweating.", need_type: "minor_symptom", medication_mentioned: "" } }],
    ]);
    const r = await runAgent({ ...base, text: "아버지가 가슴이 아파요" }, client);
    expect(r).toEqual({ type: "emergency", action: "call_911", stage: "translation", debug: NO_DEBUG });
  });
});

describe("runAgent – routing", () => {
  it("returns a sourced pharmacist route with nearby options", async () => {
    const { client, requests } = fake([
      [{ name: "record_need", input: { detected_language: "ar", need_summary_en: "My thyroid medicine runs out in two days and I need a renewal.", need_type: "prescription_renewal", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "prescription_renewal", need_summary_en: "renewal" } }],
      [{ name: "find_facilities", input: { kind: "pharmacy", limit: 3 } }],
      [{ name: "present_route", input: { guideline_match: "specific", evidence: ev("ab-pharmacist"), rule_id: "ab-pharmacist", reason: "سبب", message: "رسالة", facility_kind: "pharmacy", facility_ids: [], registry_rule_id: "ab-registry" } }],
    ]);
    const r = await runAgent({ ...base, facts: RENEWAL_FACTS, text: "دوائي سينفد بعد يومين" }, client);
    expect(r.type).toBe("route");
    if (r.type !== "route") return;
    expect(r.rule.route).toBe("pharmacist");
    expect(r.rule.source_url).toMatch(/^https:\/\//);
    expect(r.registry?.rule_id).toBe("ab-registry");
    expect(r.language).toBe("ar");
    // Province comes from the server; the model never gets booking/summary/red-flag tools.
    expect(JSON.stringify(requests[0].turns[0])).toContain("Alberta");
    expect(requests[0].tools).not.toContain("book_appointment");
    expect(requests[0].tools).not.toContain("check_red_flags");
  });

  it("rejects a rule_id the model never retrieved, and accepts the corrected one", async () => {
    const { client, requests } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "I want my lab results explained.", need_type: "lab_followup", medication_mentioned: "" } }],
      [{ name: "present_route", input: { guideline_match: "specific", evidence: "x", rule_id: "made-up", reason: "x", message: "y", facility_kind: "none", facility_ids: [], registry_rule_id: "" } }],
      [{ name: "search_care_rules", input: { need_type: "lab_followup", need_summary_en: "lab" } }],
      [{ name: "present_route", input: { guideline_match: "specific", evidence: ev("ab-virtual-care"), rule_id: "ab-virtual-care", reason: "x", message: "y", facility_kind: "none", facility_ids: [], registry_rule_id: "" } }],
    ]);
    const r = await runAgent({ ...base, facts: LAB_FACTS, text: "can someone explain my blood test results" }, client);
    expect(r).toMatchObject({ type: "route", rule: { rule_id: "ab-virtual-care" } });
    const toolResult = JSON.stringify(requests[2].turns.at(-1));
    expect(toolResult).toContain("isError");
  });

  it("asks for location when none was shared", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Need a renewal.", need_type: "prescription_renewal", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "prescription_renewal", need_summary_en: "renewal" } }],
      [{ name: "find_facilities", input: { kind: "pharmacy", limit: 5 } }],
      [{ name: "present_route", input: { guideline_match: "specific", evidence: ev("ab-pharmacist"), rule_id: "ab-pharmacist", reason: "x", message: "y", facility_kind: "pharmacy", facility_ids: [], registry_rule_id: "" } }],
    ]);
    const r = await runAgent({ ...base, facts: RENEWAL_FACTS, location: null, text: "need a refill" }, client);
    expect(r).toMatchObject({ type: "route", location_needed: true, facilities: [] });
  });

  it("does not offer the registry to someone who has a family doctor", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Lab follow-up.", need_type: "lab_followup", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "lab_followup", need_summary_en: "lab" } }],
      [{ name: "present_route", input: { guideline_match: "specific", evidence: ev("ab-family-doctor"), rule_id: "ab-family-doctor", reason: "x", message: "y", facility_kind: "none", facility_ids: [], registry_rule_id: "ab-registry" } }],
    ]);
    const r = await runAgent({ ...base, facts: LAB_FACTS, hasFamilyDoctor: "yes", text: "my doctor ordered tests" }, client);
    expect(r).toMatchObject({ type: "route", rule: { route: "family_doctor" } });
    if (r.type === "route") expect(r.registry).toBeUndefined();
  });

  it("keeps only alternatives whose rules were retrieved, and drops an unverified guide link", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Constipation for two weeks.", need_type: "minor_symptom", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "minor_symptom", need_summary_en: "constipation" } }],
      [{ name: "present_route", input: {
        guideline_match: "specific", evidence: ev("ab-pharmacist"),
        rule_id: "ab-pharmacist", reason: "x", message: "y", facility_kind: "pharmacy", facility_ids: [], registry_rule_id: "",
        alternatives: [
          { rule_id: "ab-walk-in", when: "If you also have belly pain or blood in your stool, see a doctor today.", facility_kind: "walk_in" },
          { rule_id: "made-up", when: "If anything", facility_kind: "none" },
          { rule_id: "ab-811", when: "", facility_kind: "none" },
        ],
        guide_url: "https://evil.example/page",
      } }],
    ]);
    const r = await runAgent({ ...base, text: "constipated for 2 weeks" }, client);
    expect(r.type).toBe("route");
    if (r.type !== "route") return;
    expect(r.alternatives.map((a) => a.rule.rule_id)).toEqual(["ab-walk-in"]);
    expect(r.alternatives[0].rule.source_url).toMatch(/^https:\/\//);
    expect(r.guide).toBeUndefined();
  });

  it("falls back to 811 when the model says no guideline covers it", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Strange tingling in my toes at night.", need_type: "minor_symptom", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "minor_symptom", need_summary_en: "tingling toes" } }],
      [{ name: "present_route", input: { guideline_match: "none", evidence: ev("ab-811"), rule_id: "ab-811", reason: "There is no specific guideline for this.", message: "Call 811 to talk to a nurse.", facility_kind: "none", facility_ids: [], registry_rule_id: "", alternatives: [{ rule_id: "ab-walk-in", when: "If …", facility_kind: "walk_in" }] } }],
    ]);
    const r = await runAgent({ ...base, text: "my toes tingle at night" }, client);
    expect(r).toMatchObject({ type: "route", no_guideline: true, rule: { route: "call_811" }, alternatives: [], facilities: [] });
    if (r.type === "route") expect(r.reason).toMatch(/no specific guideline/);
  });

  it("does not trust a route whose quote is not in the guideline", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Knee pain.", need_type: "minor_symptom", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "minor_symptom", need_summary_en: "knee pain" } }],
      [{ name: "present_route", input: { guideline_match: "specific", evidence: "Pharmacists can fix every kind of knee pain with surgery.", rule_id: "ab-pharmacist", reason: "x", message: "y", facility_kind: "pharmacy", facility_ids: [], registry_rule_id: "", alternatives: [] } }],
    ]);
    const r = await runAgent({ ...base, text: "knee pain" }, client);
    expect(r).toMatchObject({ type: "route", no_guideline: true, rule: { route: "call_811" }, reason: "" });
  });

  it("never lists 'find a family doctor' as an alternative", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Need a refill.", need_type: "prescription_renewal", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "prescription_renewal", need_summary_en: "refill" } }],
      [{ name: "present_route", input: { guideline_match: "specific", evidence: ev("ab-pharmacist"), rule_id: "ab-pharmacist", reason: "x", message: "y", facility_kind: "none", facility_ids: [], registry_rule_id: "ab-registry",
        alternatives: [{ rule_id: "ab-registry", when: "If you want a family doctor, register.", facility_kind: "none" }, { rule_id: "ab-walk-in", when: "If the pharmacist cannot renew it, go to a walk-in.", facility_kind: "walk_in" }] } }],
    ]);
    const r = await runAgent({ ...base, facts: RENEWAL_FACTS, text: "refill please" }, client);
    if (r.type !== "route") throw new Error("expected route");
    expect(r.alternatives.map((a) => a.rule.route)).toEqual(["walk_in"]);
    expect(r.no_guideline).toBe(false);
  });
});

describe("runAgent – follow-up questions (fact registry)", () => {
  const renewalNeed = (extra: Record<string, unknown> = {}) => ({
    name: "record_need",
    input: { detected_language: "en", need_summary_en: "Needs a prescription renewal.", need_type: "prescription_renewal", medication_mentioned: "", stated_facts: [], ...extra },
  });
  const search = { name: "search_care_rules", input: { need_type: "prescription_renewal", need_summary_en: "renewal" } };
  const presentPharmacist = {
    name: "present_route",
    input: { guideline_match: "specific", evidence: ev("ab-pharmacist"), rule_id: "ab-pharmacist", reason: "x", message: "y", facility_kind: "pharmacy", facility_ids: [], registry_rule_id: "ab-registry", alternatives: [] },
  };

  it("renewal: medication name is optional – known run-out and controlled status route without a question", async () => {
    const { client } = fake([[renewalNeed()], [search], [{ name: "find_facilities", input: { kind: "pharmacy", limit: 3 } }], [presentPharmacist]]);
    const r = await runAgent({ ...base, intake: undefined, facts: { runs_out_when: "within_2_weeks", is_controlled_drug: "no" }, text: "renew my pills" }, client);
    expect(r).toMatchObject({ type: "route", rule: { route: "pharmacist" }, no_guideline: false, debug: { asked: [], route_changed: [] } });
  });

  it("renewal with the run-out date missing asks exactly 1 follow-up, then routes", async () => {
    const known = { is_controlled_drug: "no", medication_name: "Synthroid" } as const;
    const first = fake([[renewalNeed()], [search], [{ name: "ask_clarifying_question", input: { fact_id: "runs_out_when", likely_route: "pharmacist" } }]]);
    const q = await runAgent({ ...base, facts: known, text: "I need my prescription renewed" }, first.client);
    expect(q).toMatchObject({ type: "clarify", fact_id: "runs_out_when", likely_route: "pharmacist", debug: { asked: ["runs_out_when"], route_changed: [null] } });
    // The question text is not the model's: the result carries only the fact id.
    expect(q).not.toHaveProperty("question");

    const second = fake([[renewalNeed()], [search], [{ name: "find_facilities", input: { kind: "pharmacy", limit: 3 } }], [presentPharmacist]]);
    const r = await runAgent(
      { ...base, facts: { ...known, runs_out_when: "within_3_days" }, followUps: [{ fact_id: "runs_out_when", likely_route: "pharmacist" }], text: "I need my prescription renewed" },
      second.client,
    );
    expect(r).toMatchObject({ type: "route", rule: { route: "pharmacist" }, no_guideline: false, debug: { asked: ["runs_out_when"], route_changed: [false] } });
    // Structured facts sit outside <user_request>, as plain lines.
    const turn = (second.requests[0].turns[0] as { text: string }).text;
    expect(turn.indexOf('medication_name: "Synthroid"')).toBeGreaterThan(-1);
    expect(turn.indexOf('medication_name: "Synthroid"')).toBeLessThan(turn.indexOf("<user_request>"));
    expect(turn).toContain("Follow-ups already asked: 1 of 2");
  });

  it("stops at 2 questions: a 3rd is refused, and a route fact still missing falls back to 811", async () => {
    const asked = [
      { fact_id: "medication_name", likely_route: "pharmacist" },
      { fact_id: "could_be_pregnant", likely_route: "pharmacist" },
    ] as const;
    const t = fake([
      [renewalNeed()],
      [search],
      [{ name: "ask_clarifying_question", input: { fact_id: "runs_out_when", likely_route: "pharmacist" } }], // a 3rd question is refused
      [presentPharmacist], // runs_out_when still unknown → 811
    ]);
    const r = await runAgent(
      { ...base, text: "refill", facts: { medication_name: "not_sure", could_be_pregnant: "no", is_controlled_drug: "no" }, followUps: [...asked] },
      t.client,
    );
    expect(r).toMatchObject({ type: "route", rule: { route: "call_811" }, no_guideline: true, fallback_reason: "missing_facts" });
    expect(JSON.stringify(t.requests[3].turns.at(-1))).toContain("No follow-ups left");
  });

  it("server asks for the decisive fact itself if the model routes without it twice", async () => {
    const { client } = fake([[renewalNeed()], [search], [presentPharmacist], [presentPharmacist]]);
    const r = await runAgent({ ...base, facts: { medication_name: "Synthroid", is_controlled_drug: "no" }, text: "refill" }, client);
    expect(r).toMatchObject({ type: "clarify", fact_id: "runs_out_when", likely_route: "pharmacist" });
  });

  it("severe AND getting worse never ends at a pharmacist", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Sore throat.", need_type: "minor_symptom", medication_mentioned: "", stated_facts: [] } }],
      [{ name: "search_care_rules", input: { need_type: "minor_symptom", need_summary_en: "sore throat" } }],
      [{ name: "present_route", input: { ...presentPharmacist.input, alternatives: [
        { rule_id: "ab-virtual-care", when: "If you prefer video.", facility_kind: "virtual" },
        { rule_id: "ab-811", when: "If you are not sure.", facility_kind: "none" },
      ] } }],
    ]);
    const r = await runAgent({ ...base, intake: { severity: "severe", trend: "worse", duration: "1_3_days" }, text: "my throat hurts a lot" }, client);
    if (r.type !== "route") throw new Error("expected route");
    expect(r.rule.route).toBe("walk_in");
    expect(r.escalated).toBe(true);
    expect(r.call_911_if_worse).toBe(true);
    expect(r.facilities.length).toBeGreaterThan(0);
    expect(r.alternatives.map((a) => a.rule.route)).toEqual(["call_811"]);
    expect(r.reason).toBe(""); // fixed i18n text is shown instead of the model's pharmacist reason
  });

  it("severe AND getting worse refuses follow-up questions (they cannot change the route)", async () => {
    const { client, requests } = fake([[renewalNeed()], [search], [{ name: "ask_clarifying_question", input: { fact_id: "runs_out_when", likely_route: "pharmacist" } }], [presentPharmacist]]);
    const r = await runAgent({ ...base, intake: { severity: "severe", trend: "worse" }, text: "refill, and I feel awful" }, client);
    expect(r).toMatchObject({ type: "route", rule: { route: "walk_in" }, escalated: true });
    expect(JSON.stringify(requests[3].turns.at(-1))).toContain("No follow-up needed");
  });

  const presentVirtual = {
    name: "present_route",
    input: { guideline_match: "specific", evidence: ev("ab-virtual-care"), rule_id: "ab-virtual-care", reason: "x", message: "y", facility_kind: "virtual", facility_ids: [], registry_rule_id: "", alternatives: [] },
  };

  it("controlled = not sure: no 811 – virtual care first, pharmacist as an 'if it isn't controlled' option", async () => {
    // The model insists on the pharmacist twice: the server decides.
    const insist = fake([[renewalNeed()], [search], [presentPharmacist], [presentPharmacist]]);
    const r = await runAgent({ ...base, facts: { ...RENEWAL_FACTS, is_controlled_drug: "not_sure" }, text: "refill" }, insist.client);
    if (r.type !== "route") throw new Error("expected route");
    expect(r.rule.route).toBe("virtual_care");
    expect(r.no_guideline).toBe(false);
    expect(r.fixed_reason).toBe("controlled_not_pharmacist");
    expect(r.facilities.length).toBeGreaterThan(0);
    expect(r.alternatives[0]).toMatchObject({ rule: { route: "pharmacist" }, note: "pharmacist_if_not_controlled", facility_kind: "pharmacy" });
    expect(JSON.stringify(insist.requests[3].turns.at(-1))).toContain("cannot renew");

    // The model chooses virtual care itself: its words are kept, and the pharmacist option is added.
    const good = fake([[renewalNeed()], [search], [presentVirtual]]);
    const g = await runAgent({ ...base, facts: { ...RENEWAL_FACTS, is_controlled_drug: "not_sure" }, text: "refill" }, good.client);
    expect(g).toMatchObject({ type: "route", rule: { route: "virtual_care" }, reason: "x", alternatives: [{ rule: { route: "pharmacist" }, note: "pharmacist_if_not_controlled" }] });
  });

  it("controlled still unknown after 2 follow-ups counts as 'not sure' (no 811)", async () => {
    const asked = [
      { fact_id: "runs_out_when", likely_route: "pharmacist" },
      { fact_id: "medication_name", likely_route: "pharmacist" },
    ] as const;
    const { client } = fake([[renewalNeed()], [search], [presentPharmacist], [presentPharmacist]]);
    const r = await runAgent({ ...base, facts: { runs_out_when: "later", medication_name: "not_sure" }, followUps: [...asked], text: "refill" }, client);
    expect(r).toMatchObject({ type: "route", rule: { route: "virtual_care" }, no_guideline: false });
  });

  it("controlled = yes: never the pharmacist, not even as an alternative", async () => {
    const alts = { ...presentVirtual.input, alternatives: [{ rule_id: "ab-pharmacist", when: "If you prefer a pharmacy.", facility_kind: "pharmacy" }] };
    const { client } = fake([[renewalNeed()], [search], [{ name: "present_route", input: alts }]]);
    const r = await runAgent({ ...base, facts: { ...RENEWAL_FACTS, is_controlled_drug: "yes" }, text: "refill" }, client);
    if (r.type !== "route") throw new Error("expected route");
    expect(r.rule.route).toBe("virtual_care");
    expect(r.alternatives.map((a) => a.rule.route)).not.toContain("pharmacist");
    expect(r.dont_stop_medicine).toBe(false);
  });

  it("controlled = yes and already out → walk-in/urgent care today, with 'don't stop suddenly'", async () => {
    for (const steps of [[presentVirtual], [presentPharmacist, presentPharmacist]]) {
      const { client } = fake([[renewalNeed()], [search], ...steps.map((s) => [s])]);
      const r = await runAgent({ ...base, facts: { ...RENEWAL_FACTS, is_controlled_drug: "yes", runs_out_when: "already_out" }, text: "out of my pills" }, client);
      expect(r).toMatchObject({ type: "route", rule: { route: "walk_in" }, escalated: true, fixed_reason: "controlled_already_out", dont_stop_medicine: true });
    }
  });

  it("the model saying 'not controlled' is not enough; the person must answer", async () => {
    const { client } = fake([
      [renewalNeed({ stated_facts: [{ fact_id: "is_controlled_drug", value: "no" }, { fact_id: "medication_name", value: "Synthroid" }, { fact_id: "runs_out_when", value: "later" }] })],
      [search],
      [presentPharmacist],
      [presentPharmacist],
    ]);
    const r = await runAgent({ ...base, text: "renew my Synthroid, I have a few weeks left" }, client);
    expect(r).toMatchObject({ type: "clarify", fact_id: "is_controlled_drug" });
  });

  it("the person saying 'no' is overridden when the drug database lists a controlled schedule", async () => {
    // lookup_medication hits the network; stub fetch with a DPD answer for a narcotic.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const body = String(url).includes("/schedule/")
        ? [{ schedule_name: "Narcotic (CDSA I)" }]
        : String(url).includes("/drugproduct/")
          ? [{ drug_code: 1, brand_name: "OXY", drug_identification_number: "00000001" }]
          : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const { client } = fake([[renewalNeed()], [search], [{ name: "lookup_medication", input: { query: "oxy" } }], [presentPharmacist], [presentPharmacist]]);
      const r = await runAgent({ ...base, facts: RENEWAL_FACTS, text: "refill my oxy" }, client);
      expect(r).toMatchObject({ type: "route", rule: { route: "virtual_care" }, fixed_reason: "controlled_not_pharmacist" });
      if (r.type === "route") expect(r.alternatives.map((a) => a.rule.route)).not.toContain("pharmacist");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("symptom requests need severity, trend and duration; renewals and labs don't", async () => {
    const symptom = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Sore throat.", need_type: "minor_symptom", medication_mentioned: "", stated_facts: [] } }],
    ]);
    const q = await runAgent({ ...base, intake: { severity: "mild" }, text: "sore throat" }, symptom.client);
    expect(q).toMatchObject({ type: "clarify", fact_id: null, intake_needed: ["trend", "duration"], debug: { asked: [] } });

    const renewal = fake([[renewalNeed()], [search], [presentPharmacist]]);
    expect(await runAgent({ ...base, intake: undefined, facts: RENEWAL_FACTS, text: "refill" }, renewal.client)).toMatchObject({ type: "route" });
    const lab = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Lab follow-up.", need_type: "lab_followup", medication_mentioned: "", stated_facts: [] } }],
      [{ name: "search_care_rules", input: { need_type: "lab_followup", need_summary_en: "lab" } }],
      [presentVirtual],
    ]);
    expect(await runAgent({ ...base, intake: {}, facts: LAB_FACTS, text: "lab results" }, lab.client)).toMatchObject({ type: "route", rule: { route: "virtual_care" } });
  });

  it("a child whose request mentions fever is asked the temperature (code, not AI); 40 °C+ means care today", async () => {
    const symptomNeed = { name: "record_need", input: { detected_language: "en", need_summary_en: "Child has a fever and sore throat.", need_type: "minor_symptom", medication_mentioned: "", stated_facts: [] } };
    const symptomSearch = { name: "search_care_rules", input: { need_type: "minor_symptom", need_summary_en: "fever" } };
    const child = { ...base, ageGroup: "child" as const, ageMonths: 72, text: "my son has a fever" };
    const q = await runAgent(child, fake([[symptomNeed], [symptomSearch], [presentPharmacist]]).client);
    expect(q).toMatchObject({ type: "clarify", fact_id: "temperature_c" });

    const hot = await runAgent(
      { ...child, facts: { temperature_c: "40_or_higher" }, followUps: [{ fact_id: "temperature_c", likely_route: "pharmacist" }] },
      fake([[symptomNeed], [symptomSearch], [presentPharmacist]]).client,
    );
    expect(hot).toMatchObject({ type: "route", rule: { route: "walk_in" }, fixed_reason: "child_urgent", call_911_if_worse: true });

    const mild = await runAgent(
      { ...child, facts: { temperature_c: "38_to_38_9" }, followUps: [{ fact_id: "temperature_c", likely_route: "pharmacist" }] },
      fake([[symptomNeed], [symptomSearch], [presentPharmacist]]).client,
    );
    expect(mild).toMatchObject({ type: "route", rule: { route: "pharmacist" } });

    // Adults are not asked.
    const adult = await runAgent({ ...base, text: "I have a fever" }, fake([[symptomNeed], [symptomSearch], [presentPharmacist]]).client);
    expect(adult).toMatchObject({ type: "route", rule: { route: "pharmacist" } });
  });

  it("a 2-month-old with fever still triggers the red flag through the exact ageMonths", async () => {
    const { client, requests } = fake([]);
    const r = await runAgent({ ...base, ageGroup: "infant", ageMonths: 2, text: "my baby has a fever" }, client);
    expect(r).toMatchObject({ type: "emergency", action: "call_811", stage: "input" });
    expect(requests).toHaveLength(0);
    // A tap answer can also add the flag when the words don't say "fever".
    const viaAnswer = await runAgent({ ...base, ageGroup: "infant", ageMonths: 2, facts: { temperature_c: "38_to_38_9" }, text: "she feels warm" }, fake([]).client);
    expect(viaAnswer).toMatchObject({ type: "emergency", action: "call_811" });
    // A 5-month-old is not under the infant-fever rule; the exact months decide, not the "infant" group.
    const older = await runAgent({ ...base, ageGroup: "infant", ageMonths: 5, text: "my baby has a fever" }, fake([]).client);
    expect(older.type).not.toBe("emergency");
  });

  it("preferredMode only reorders alternatives, never the main route", async () => {
    const alts = [
      { rule_id: "ab-walk-in", when: "If you want to be seen in person.", facility_kind: "walk_in" },
      { rule_id: "ab-virtual-care", when: "If you prefer video.", facility_kind: "virtual" },
    ];
    const run = (preferredMode?: "virtual" | "in_person") =>
      runAgent(
        { ...base, facts: RENEWAL_FACTS, profile: { preferredMode }, text: "refill" },
        fake([[renewalNeed()], [search], [{ name: "present_route", input: { ...presentPharmacist.input, alternatives: alts } }]]).client,
      );
    const v = await run("virtual");
    const p = await run("in_person");
    if (v.type !== "route" || p.type !== "route") throw new Error("expected routes");
    expect(v.rule.route).toBe("pharmacist");
    expect(p.rule.route).toBe("pharmacist");
    expect(v.alternatives.map((a) => a.rule.route)).toEqual(["virtual_care", "walk_in"]);
    expect(p.alternatives.map((a) => a.rule.route)).toEqual(["walk_in", "virtual_care"]);
  });

  it("puts coverage in the user turn so the agent can mention cost", async () => {
    const { client, requests } = fake([[renewalNeed()], [search], [presentPharmacist]]);
    await runAgent({ ...base, facts: RENEWAL_FACTS, profile: { coverage: "waiting_for_coverage" }, text: "refill" }, client);
    const turn = (requests[0].turns[0] as { text: string }).text;
    expect(turn).toMatch(/Coverage: waiting_for_coverage.*cost money/);
    expect(turn.indexOf("Coverage:")).toBeLessThan(turn.indexOf("<user_request>"));
  });
});
