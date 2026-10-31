import { describe, expect, it } from "vitest";
import { runAgent, type AgentInput } from "./runAgent";
import type { LlmClient, Turn } from "../llm/types";

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
const base: AgentInput = { province: "AB", text: "", ageGroup: "adult", hasFamilyDoctor: "no", location: CALGARY };

describe("runAgent – safety gates", () => {
  it("stops before any model call when the raw text has a red flag", async () => {
    const { client, requests } = fake([]);
    const r = await runAgent({ ...base, text: "I have chest pain" }, client);
    expect(r).toEqual({ type: "emergency", action: "call_911", stage: "input" });
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
    expect(r).toEqual({ type: "emergency", action: "call_911", stage: "translation" });
  });
});

describe("runAgent – routing", () => {
  it("returns a sourced pharmacist route with nearby options", async () => {
    const { client, requests } = fake([
      [{ name: "record_need", input: { detected_language: "ar", need_summary_en: "My thyroid medicine runs out in two days and I need a renewal.", need_type: "prescription_renewal", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "prescription_renewal", need_summary_en: "renewal" } }],
      [{ name: "find_facilities", input: { kind: "pharmacy", limit: 3 } }],
      [{ name: "present_route", input: { rule_id: "ab-pharmacist", reason: "سبب", message: "رسالة", facility_kind: "pharmacy", facility_ids: [], registry_rule_id: "ab-registry" } }],
    ]);
    const r = await runAgent({ ...base, text: "دوائي سينفد بعد يومين" }, client);
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
      [{ name: "present_route", input: { rule_id: "made-up", reason: "x", message: "y", facility_kind: "none", facility_ids: [], registry_rule_id: "" } }],
      [{ name: "search_care_rules", input: { need_type: "lab_followup", need_summary_en: "lab" } }],
      [{ name: "present_route", input: { rule_id: "ab-virtual-care", reason: "x", message: "y", facility_kind: "none", facility_ids: [], registry_rule_id: "" } }],
    ]);
    const r = await runAgent({ ...base, text: "can someone explain my blood test results" }, client);
    expect(r).toMatchObject({ type: "route", rule: { rule_id: "ab-virtual-care" } });
    const toolResult = JSON.stringify(requests[2].turns.at(-1));
    expect(toolResult).toContain("isError");
  });

  it("asks for location when none was shared", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Need a renewal.", need_type: "prescription_renewal", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "prescription_renewal", need_summary_en: "renewal" } }],
      [{ name: "find_facilities", input: { kind: "pharmacy", limit: 5 } }],
      [{ name: "present_route", input: { rule_id: "ab-pharmacist", reason: "x", message: "y", facility_kind: "pharmacy", facility_ids: [], registry_rule_id: "" } }],
    ]);
    const r = await runAgent({ ...base, location: null, text: "need a refill" }, client);
    expect(r).toMatchObject({ type: "route", location_needed: true, facilities: [] });
  });

  it("does not offer the registry to someone who has a family doctor", async () => {
    const { client } = fake([
      [{ name: "record_need", input: { detected_language: "en", need_summary_en: "Lab follow-up.", need_type: "lab_followup", medication_mentioned: "" } }],
      [{ name: "search_care_rules", input: { need_type: "lab_followup", need_summary_en: "lab" } }],
      [{ name: "present_route", input: { rule_id: "ab-family-doctor", reason: "x", message: "y", facility_kind: "none", facility_ids: [], registry_rule_id: "ab-registry" } }],
    ]);
    const r = await runAgent({ ...base, hasFamilyDoctor: "yes", text: "my doctor ordered tests" }, client);
    expect(r).toMatchObject({ type: "route", rule: { route: "family_doctor" } });
    if (r.type === "route") expect(r.registry).toBeUndefined();
  });
});
