/**
 * The CareRoute agent: a manual tool-use loop (OpenAI or Claude, see lib/llm) with hard safety gates.
 *
 *  1. checkRedFlags(raw text, checklist, age)        ← rules, before any model call
 *  2. model → record_need → checkRedFlags(English)   ← rules again on the translation
 *  3. model → search_care_rules / find_facilities / check_er_waits / lookup_medication
 *  4. model → present_route → server validates rule_id + facility ids and attaches sources
 */
import { checkRedFlags, type RedFlagAction, type RedFlagCategory } from "../safety/redFlags";
import { PROVINCES, type ProvinceCode } from "../provinces";
import { getRule, searchCareRules, type NeedType } from "../tools/careRules";
import { checkErWaits, findFacilities, type Facility, type FacilityKind } from "../tools/facilities";
import { lookupMedication } from "../tools/medication";
import { TOOLS } from "../tools/definitions";
import { SYSTEM_PROMPT, userTurn } from "./prompt";
import { defaultLlm } from "../llm";
import type { LlmClient, Turn } from "../llm/types";
import type { AgeGroup, CareRoute } from "../types";

const MAX_STEPS = 10;

export interface AgentInput {
  province: ProvinceCode;
  text: string;
  ageGroup: AgeGroup;
  ageMonths?: number;
  hasFamilyDoctor: "yes" | "no" | "hard_to_access";
  checklist?: Partial<Record<RedFlagCategory, boolean>>;
  location?: { lat: number; lng: number } | null;
  city?: string;
}

export interface SourcedRule {
  rule_id: string;
  route: CareRoute;
  title: string;
  source_url: string;
  sources: { title: string; url: string }[];
}

export type AgentResult =
  | { type: "emergency"; action: RedFlagAction; stage: "input" | "translation" }
  | { type: "clarify"; question: string; language: string }
  | {
      type: "route";
      language: string;
      need_type: NeedType;
      need_summary_en: string;
      rule: SourcedRule;
      reason: string;
      message: string;
      facility_kind: FacilityKind | null;
      facilities: (Facility & { wait_minutes?: number | null })[];
      er_waits_source?: { name: string; url: string; refreshed_at: string };
      registry?: SourcedRule;
      location_needed: boolean;
    }
  | { type: "error"; message: string };

const toSourced = (province: ProvinceCode, id: string): SourcedRule | undefined => {
  const r = getRule(province, id);
  return r && { rule_id: r.id, route: r.route, title: r.title, source_url: r.source_url, sources: r.sources };
};

export async function runAgent(input: AgentInput, injected?: LlmClient): Promise<AgentResult> {
  const province = PROVINCES[input.province];
  if (!province?.enabled) return { type: "error", message: "Province not supported yet." };
  const text = (input.text ?? "").slice(0, 4000);

  // ── Gate 1: hard-coded rules on the raw input. No model call if this fires.
  const flags = checkRedFlags({ text, checklist: input.checklist, ageMonths: input.ageMonths });
  if (flags.triggered) return { type: "emergency", action: flags.action, stage: "input" };
  if (!text.trim()) return { type: "clarify", question: "", language: "en" };
  const llm = injected ?? defaultLlm(); // created only after gate 1, so emergencies work without an API key

  const turns: Turn[] = [
    {
      role: "user",
      text: userTurn({
        province: province.code,
        provinceName: province.name,
        ageGroup: input.ageGroup,
        ageMonths: input.ageMonths,
        hasFamilyDoctor: input.hasFamilyDoctor,
        hasLocation: !!input.location,
        city: input.city,
        today: new Date().toISOString().slice(0, 10),
        text,
      }),
    },
  ];

  // State the server tracks so the final answer can be verified.
  let need: { language: string; summary: string; type: NeedType } | null = null;
  const seenRuleIds = new Set<string>();
  const seenFacilities = new Map<string, Facility>();
  let waits: ReturnType<typeof checkErWaits> | null = null;
  let locationNeeded = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await llm.complete({ system: SYSTEM_PROMPT, tools: TOOLS, turns });

    if (res.stop === "refusal") return { type: "error", message: "refusal" };
    if (res.stop === "max_tokens") return { type: "error", message: "max_tokens" };
    turns.push({ role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw });

    const calls = res.toolCalls;
    if (calls.length === 0) {
      // The model answered in prose. Nudge toward the required finishing tool.
      turns.push({ role: "user", text: "Please finish by calling present_route (or ask_clarifying_question)." });
      continue;
    }

    const results: { id: string; content: string; isError?: boolean }[] = [];
    for (const call of calls) {
      const args = call.input ?? {};
      const ok = (content: unknown) => ({ id: call.id, content: JSON.stringify(content) });
      const fail = (msg: string) => ({ ...ok({ error: msg }), isError: true });

      switch (call.name) {
        case "record_need": {
          need = {
            language: String(args.detected_language || "en"),
            summary: String(args.need_summary_en || ""),
            type: (args.need_type as NeedType) || "other",
          };
          // ── Gate 2: same rules on the model's English restatement. Can only ADD a red flag.
          const again = checkRedFlags({ text: need.summary, ageMonths: input.ageMonths });
          if (again.triggered) return { type: "emergency", action: again.action, stage: "translation" };
          results.push(ok({ recorded: true }));
          break;
        }
        case "search_care_rules": {
          if (!need) {
            results.push(fail("Call record_need first."));
            break;
          }
          const out = searchCareRules({
            province: input.province,
            need_type: (args.need_type as NeedType) || need.type,
            need_summary_en: String(args.need_summary_en || need.summary),
            age_group: input.ageGroup,
            has_family_doctor: input.hasFamilyDoctor,
          });
          out.rules.forEach((r) => seenRuleIds.add(r.rule_id));
          results.push(ok(out));
          break;
        }
        case "lookup_medication":
          results.push(ok(await lookupMedication(String(args.query || ""))));
          break;
        case "find_facilities": {
          const kind = args.kind as FacilityKind;
          if (!["pharmacy", "walk_in", "urgent_care"].includes(kind)) {
            results.push(fail("kind must be pharmacy, walk_in or urgent_care"));
            break;
          }
          const out = findFacilities({
            province: input.province,
            kind,
            lat: input.location?.lat,
            lng: input.location?.lng,
            limit: Number(args.limit) || 5,
          });
          if (!out.location_used) locationNeeded = true;
          out.facilities.forEach((f) => seenFacilities.set(f.id, f));
          // Give the model only what it needs to choose; the UI gets full records.
          results.push(
            ok({
              ...out,
              facilities: out.facilities.map((f) => ({
                id: f.id, name: f.name, kind: f.kind, city: f.city, distance_km: f.distance_km,
                hours: f.hours.slice(0, 160), accepts_walk_in: f.accepts_walk_in, languages: f.languages,
              })),
            }),
          );
          break;
        }
        case "check_er_waits": {
          // Red flags were already excluded at both gates, so showing waits is allowed here.
          waits = checkErWaits(input.province, Array.isArray(args.facility_ids) ? (args.facility_ids as string[]) : undefined);
          results.push(ok(waits));
          break;
        }
        case "ask_clarifying_question":
          return { type: "clarify", question: String(args.question || ""), language: need?.language ?? "en" };
        case "present_route": {
          const rule = toSourced(input.province, String(args.rule_id || ""));
          if (!rule || !seenRuleIds.has(rule.rule_id)) {
            results.push(fail("rule_id must be one returned by search_care_rules in this conversation."));
            break;
          }
          const kindArg = String(args.facility_kind || "none");
          const kind = (["pharmacy", "walk_in", "urgent_care"].includes(kindArg) ? kindArg : null) as FacilityKind | null;
          const ids = Array.isArray(args.facility_ids) ? (args.facility_ids as string[]) : [];
          let facilities = ids.map((id) => seenFacilities.get(id)).filter((f): f is Facility => !!f);
          if (kind && facilities.length === 0) facilities = [...seenFacilities.values()].slice(0, 5);
          const waitById = new Map((waits?.sites ?? []).map((s) => [s.id, s.wait_minutes]));
          const regId = String(args.registry_rule_id || "");
          const registry =
            input.hasFamilyDoctor !== "yes"
              ? toSourced(input.province, regId) ?? toSourced(input.province, `${province.dir}-registry`)
              : undefined;
          return {
            type: "route",
            language: need?.language ?? "en",
            need_type: need?.type ?? "other",
            need_summary_en: need?.summary ?? "",
            rule,
            reason: String(args.reason || ""),
            message: String(args.message || ""),
            facility_kind: kind,
            facilities: facilities.slice(0, 5).map((f) => (waitById.has(f.id) ? { ...f, wait_minutes: waitById.get(f.id) } : f)),
            er_waits_source: waits?.available ? { name: waits.source_name!, url: waits.source_url!, refreshed_at: waits.refreshed_at! } : undefined,
            registry: registry && registry.rule_id !== rule.rule_id ? registry : undefined,
            location_needed: locationNeeded && facilities.length === 0,
          };
        }
        default:
          results.push(fail(`Unknown tool ${call.name}`));
      }
    }
    turns.push({ role: "tool_results", results });
  }
  return { type: "error", message: "The assistant took too many steps." };
}
