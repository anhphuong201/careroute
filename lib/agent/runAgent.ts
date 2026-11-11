/**
 * The CareRoute agent: a manual tool-use loop (OpenAI or Claude, see lib/llm) with hard safety gates.
 *
 *  1. checkRedFlags(raw text + tap answers, checklist, exact age)  ← rules, before any model call
 *  2. model → record_need → checkRedFlags(English)                 ← rules again on the translation
 *  3. model → search_care_rules / find_facilities / check_er_waits / lookup_medication
 *     model → ask_clarifying_question(fact_id)                      ← max 2 per request, text from the registry
 *  4. model → present_route → server validates rule_id, facility ids, required facts and the
 *     deterministic escalations (severe + worse, controlled drugs), then attaches sources
 */
import { checkRedFlags, type RedFlagAction, type RedFlagCategory } from "../safety/redFlags";
import { PROVINCES, type ProvinceCode } from "../provinces";
import { getRule, searchCareRules, type NeedType } from "../tools/careRules";
import { checkErWaits, findFacilities, type Facility, type FacilityKind } from "../tools/facilities";
import { lookupMedication } from "../tools/medication";
import { symptomGuide } from "../tools/symptomGuide";
import { evidenceSupported } from "./evidence";
import { ROUTES, TOOLS } from "../tools/definitions";
import { SYSTEM_PROMPT, userTurn } from "./prompt";
import { defaultLlm } from "../llm";
import type { LlmClient, Turn } from "../llm/types";
import type { AgeGroup, CareRoute } from "../types";
import {
  MAX_FOLLOW_UPS,
  controlledOrUnsure,
  factLines,
  isFactId,
  knownFacts,
  missingDecisiveFacts,
  mostCautious,
  redFlagHints,
  validateFactAnswer,
  type FactAnswers,
  type FactId,
  type FollowUp,
} from "../facts";
import { needsEscalation, type CoreIntake, type ProfileIntake } from "../intake";

const MAX_STEPS = 10;

export interface AgentInput {
  province: ProvinceCode;
  text: string;
  ageGroup: AgeGroup;
  /** Exact age in months (from birth date or the age question). Drives the infant fever rule. */
  ageMonths?: number;
  hasFamilyDoctor: "yes" | "no" | "hard_to_access";
  checklist?: Partial<Record<RedFlagCategory, boolean>>;
  location?: { lat: number; lng: number } | null;
  city?: string;
  /** Core intake taps: trend, severity, duration bucket. */
  intake?: CoreIntake;
  /** Saved profile. preferredMode only orders options; it never changes the route. */
  profile?: ProfileIntake;
  /** Tap answers to earlier follow-ups (validated against the registry). */
  facts?: FactAnswers;
  /** Follow-ups already asked for this request, in order (max 2). */
  followUps?: FollowUp[];
}

export interface SourcedRule {
  rule_id: string;
  route: CareRoute;
  title: string;
  source_url: string;
  sources: { title: string; url: string }[];
}

/** Not persisted, no health details: which facts were asked, and whether the route changed after each answer. */
export interface AgentDebug {
  asked: FactId[];
  /** One entry per asked fact: true/false once the next decision is known, null while unanswered. */
  route_changed: (boolean | null)[];
}

export type FallbackReason = "no_guideline" | "missing_facts" | "controlled_drug";

export type RouteResult = {
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
  alternatives: { rule: SourcedRule; when: string; facility_kind: FacilityKind | null }[];
  guide?: { title: string; url: string };
  /** English reason-for-visit text for booking forms / phone calls. */
  booking_note: string;
  /** true when the route is forced to 811 (see fallback_reason). */
  no_guideline: boolean;
  fallback_reason?: FallbackReason;
  /** The server bumped the route (severe AND getting worse). reason/message are then shown from i18n, not the model. */
  escalated: boolean;
  /** Show "call 9-1-1 if it gets worse" (severe AND getting worse). */
  call_911_if_worse: boolean;
  /** Supporting text from the guideline (verified against the rule). */
  evidence?: string;
  location_needed: boolean;
  debug: AgentDebug;
};

export type AgentResult =
  | { type: "emergency"; action: RedFlagAction; stage: "input" | "translation"; debug: AgentDebug }
  | { type: "clarify"; fact_id: FactId | null; likely_route: CareRoute | null; language: string; debug: AgentDebug }
  | RouteResult
  | { type: "error"; message: string };

const toSourced = (province: ProvinceCode, id: string): SourcedRule | undefined => {
  const r = getRule(province, id);
  return r && { rule_id: r.id, route: r.route, title: r.title, source_url: r.source_url, sources: r.sources };
};

const KINDS = ["pharmacy", "walk_in", "urgent_care", "virtual"];
const asKind = (v: unknown) => (KINDS.includes(String(v)) ? (String(v) as FacilityKind) : null);
const asRoute = (v: unknown) => ((ROUTES as readonly string[]).includes(String(v)) ? (String(v) as CareRoute) : null);

/** Routes that a severe + worsening problem must never end at. */
const NOT_FOR_SEVERE_WORSE: CareRoute[] = ["pharmacist", "registry", "virtual_care", "family_doctor"];
const CONTROLLED_SCHEDULE = /narcotic|controlled|targeted|cdsa|schedule\s*g\b/i;
const MODE_ROUTES: Record<string, CareRoute[]> = {
  in_person: ["walk_in", "pharmacist", "family_doctor"],
  virtual: ["virtual_care"],
  phone: ["call_811", "virtual_care"],
};

export async function runAgent(input: AgentInput, injected?: LlmClient): Promise<AgentResult> {
  const province = PROVINCES[input.province];
  if (!province?.enabled) return { type: "error", message: "Province not supported yet." };
  const text = (input.text ?? "").slice(0, 4000);
  const followUps = (input.followUps ?? []).slice(0, MAX_FOLLOW_UPS);
  const intake = input.intake ?? {};
  const escalate = needsEscalation(intake);

  // Facts known so far. The person's taps first; the model's stated_facts and the drug database can only
  // fill gaps – except is_controlled_drug, where the most cautious answer always wins.
  const facts: FactAnswers = { ...(input.facts ?? {}) };

  const debugFor = (finalRoute: CareRoute | null, current?: FollowUp): AgentDebug => {
    const list = [...followUps, ...(current ? [current] : [])];
    return {
      asked: list.map((f) => f.fact_id),
      route_changed: list.map((f, i) => {
        const next = i + 1 < list.length ? list[i + 1].likely_route : finalRoute;
        return next ? next !== f.likely_route : null;
      }),
    };
  };

  // ── Gate 1: hard-coded rules on the raw input (+ tap answers that can only ADD urgency). No model call if this fires.
  const flags = checkRedFlags({ text: [text, redFlagHints(facts)].join("\n"), checklist: input.checklist, ageMonths: input.ageMonths });
  if (flags.triggered) return { type: "emergency", action: flags.action, stage: "input", debug: debugFor(null) };
  if (!text.trim()) return { type: "clarify", fact_id: null, likely_route: null, language: "en", debug: debugFor(null) };
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
        severity: intake.severity,
        trend: intake.trend,
        duration: intake.duration,
        coverage: input.profile?.coverage,
        higherRisk: input.profile?.higherRisk,
        facts: factLines(facts),
        followUpsAsked: followUps.length,
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
  const guides = new Map<string, string>(); // url → title, from symptom_guide
  const askedIds = new Set<string>(followUps.map((f) => f.fact_id));
  let nudgedForFacts = false;
  let nudgedForControlled = false;

  const lang = () => need?.language ?? "en";

  const clarify = (fact: FactId, likely: CareRoute | null): AgentResult => ({
    type: "clarify",
    fact_id: fact,
    likely_route: likely,
    language: lang(),
    debug: debugFor(null, { fact_id: fact, likely_route: likely ?? "call_811" }),
  });

  /** Route to Health Link 811 (no guideline, facts still missing, or a blocked pharmacist renewal). */
  const fallback811 = (args: Record<string, unknown>, why: FallbackReason): RouteResult => {
    const modelSaidNone = why === "no_guideline" && String(args.guideline_match) === "none";
    return {
      type: "route",
      language: lang(),
      need_type: need?.type ?? "other",
      need_summary_en: need?.summary ?? "",
      rule: toSourced(input.province, `${province.dir}-811`)!,
      // Keep the model's own words only when it chose "none" itself (they are in the user's language).
      reason: modelSaidNone ? String(args.reason || "") : "",
      message: modelSaidNone ? String(args.message || "") : "",
      facility_kind: null,
      facilities: [],
      registry: input.hasFamilyDoctor !== "yes" ? toSourced(input.province, `${province.dir}-registry`) : undefined,
      alternatives: [],
      booking_note: (String(args.booking_note_en || "") || need?.summary || "").slice(0, 300),
      no_guideline: true,
      fallback_reason: why,
      escalated: false,
      call_911_if_worse: escalate,
      location_needed: false,
      debug: debugFor("call_811"),
    };
  };

  /** Severe AND getting worse → never pharmacist / registry / virtual / family doctor. Deterministic, not AI. */
  const applyEscalation = (r: RouteResult): RouteResult => {
    if (!escalate) return r;
    const safeAlts = r.alternatives.filter((a) => !NOT_FOR_SEVERE_WORSE.includes(a.rule.route));
    if (!NOT_FOR_SEVERE_WORSE.includes(r.rule.route)) return { ...r, alternatives: safeAlts, call_911_if_worse: true };
    const walkIn = toSourced(input.province, `${province.dir}-walk-in`);
    if (!walkIn) return { ...fallback811({}, "no_guideline"), call_911_if_worse: true };
    const near = findFacilities({ province: input.province, kind: "walk_in", lat: input.location?.lat, lng: input.location?.lng, limit: 5 });
    const w = checkErWaits(input.province, near.facilities.map((f) => f.id));
    const waitById = new Map(w.sites.map((s) => [s.id, s.wait_minutes]));
    const nurse = toSourced(input.province, `${province.dir}-811`)!;
    return {
      ...r,
      rule: walkIn,
      reason: "",
      message: "",
      facility_kind: "walk_in",
      facilities: near.facilities.map((f) => (waitById.has(f.id) ? { ...f, wait_minutes: waitById.get(f.id) } : f)),
      er_waits_source: w.available && w.sites.length ? { name: w.source_name!, url: w.source_url!, refreshed_at: w.refreshed_at! } : undefined,
      alternatives: [{ rule: nurse, when: "", facility_kind: null }],
      evidence: undefined,
      escalated: true,
      call_911_if_worse: true,
      location_needed: !near.location_used,
      debug: debugFor(walkIn.route),
    };
  };

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
          // Facts the model read in the user's own words fill gaps only. A "no" (or "not sure") about a controlled
          // drug must come from the person, never from the model.
          for (const sf of Array.isArray(args.stated_facts) ? (args.stated_facts as Record<string, unknown>[]) : []) {
            const id = sf?.fact_id;
            if (!isFactId(id)) continue;
            const value = validateFactAnswer(id, sf.value);
            if (value === null) continue;
            if (id === "is_controlled_drug") {
              if (value === "yes") facts.is_controlled_drug = "yes";
            } else if (facts[id] === undefined) facts[id] = value;
          }
          // ── Gate 2: same rules on the model's English restatement. Can only ADD a red flag.
          const again = checkRedFlags({ text: [need.summary, redFlagHints(facts)].join("\n"), ageMonths: input.ageMonths });
          if (again.triggered) return { type: "emergency", action: again.action, stage: "translation", debug: debugFor(null) };
          results.push(ok({ recorded: true, known_facts: Object.keys(facts) }));
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
        case "symptom_guide": {
          const g = await symptomGuide(String(args.query || ""), input.ageGroup);
          if (g.found) guides.set(g.url, g.title);
          results.push(ok(g));
          break;
        }
        case "lookup_medication": {
          const out = await lookupMedication(String(args.query || ""));
          // The drug database can only make this MORE cautious: a controlled schedule means "yes".
          const products = "products" in out && Array.isArray(out.products) ? out.products : [];
          if (products.some((p) => (p.schedules ?? []).some((s: string) => CONTROLLED_SCHEDULE.test(s)))) {
            facts.is_controlled_drug = mostCautious(facts.is_controlled_drug, "yes");
          }
          results.push(ok(out));
          break;
        }
        case "find_facilities": {
          const kind = args.kind as FacilityKind;
          if (!KINDS.includes(kind)) {
            results.push(fail("kind must be pharmacy, walk_in, urgent_care or virtual"));
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
                ...(f.kind === "virtual" ? { modes: f.modes, how: f.how, limits: f.limits, official: f.official } : {}),
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
        case "ask_clarifying_question": {
          const id = args.fact_id;
          if (!need || seenRuleIds.size === 0) results.push(fail("Call record_need and search_care_rules first."));
          else if (!isFactId(id)) results.push(fail("fact_id must be one of the listed facts."));
          else if (escalate) results.push(fail("No follow-up needed: severe and getting worse. Call present_route now (walk-in/urgent care or 811)."));
          else if (knownFacts(facts).has(id) || askedIds.has(id)) results.push(fail(`${id} is already known or was already asked. Use what you have.`));
          else if (followUps.length >= MAX_FOLLOW_UPS)
            results.push(fail("No follow-ups left (2 already asked). Call present_route now; if facts that decide the route are still missing, use the 811 rule."));
          else return clarify(id, asRoute(args.likely_route));
          break;
        }
        case "present_route": {
          // ── Grounding gate: route must be backed by a quote from the rule; otherwise 811.
          const claimed = getRule(input.province, String(args.rule_id || ""));
          const evidence = String(args.evidence || "");
          if (String(args.guideline_match) !== "none" && (!claimed || !seenRuleIds.has(claimed.id))) {
            results.push(fail("rule_id must be one returned by search_care_rules in this conversation."));
            break;
          }
          const grounded =
            String(args.guideline_match) === "specific" && !!claimed && seenRuleIds.has(claimed.id) && evidenceSupported(evidence, claimed.body);
          if (!grounded || !claimed) return fallback811(args, "no_guideline");

          const needType = need?.type ?? "other";
          if (!escalate) {
            // ── Controlled (or maybe controlled) medicine: never a pharmacist renewal.
            if (claimed.route === "pharmacist" && needType === "prescription_renewal" && controlledOrUnsure(facts)) {
              if (!nudgedForControlled) {
                nudgedForControlled = true;
                results.push(fail("is_controlled_drug is yes or not sure: a pharmacist cannot renew it here. Choose virtual care, walk-in or the family doctor."));
                break;
              }
              return fallback811(args, "controlled_drug");
            }
            // ── Facts that decide this route must be known (asked, stated, or "not sure").
            const missing = missingDecisiveFacts(claimed.required_facts, needType, knownFacts(facts)).filter((f) => !askedIds.has(f));
            if (missing.length) {
              if (followUps.length >= MAX_FOLLOW_UPS) return fallback811(args, "missing_facts");
              if (!nudgedForFacts) {
                nudgedForFacts = true;
                results.push(fail(`Still unknown and decides this route: ${missing.join(", ")}. Call ask_clarifying_question with the most decisive one.`));
                break;
              }
              return clarify(missing[0], claimed.route);
            }
          }

          const rule = toSourced(input.province, claimed.id)!;
          const kind = asKind(args.facility_kind);
          const ids = Array.isArray(args.facility_ids) ? (args.facility_ids as string[]) : [];
          let facilities = ids.map((id) => seenFacilities.get(id)).filter((f): f is Facility => !!f);
          if (kind && facilities.length === 0) facilities = [...seenFacilities.values()].slice(0, 5);
          const waitById = new Map((waits?.sites ?? []).map((s) => [s.id, s.wait_minutes]));
          const regId = String(args.registry_rule_id || "");
          const registry =
            input.hasFamilyDoctor !== "yes"
              ? toSourced(input.province, regId) ?? toSourced(input.province, `${province.dir}-registry`)
              : undefined;
          const blockPharmacist = needType === "prescription_renewal" && controlledOrUnsure(facts);
          const mode = input.profile?.preferredMode;
          const prefers = (r: CareRoute) => (mode && MODE_ROUTES[mode]?.includes(r) ? 1 : 0);
          const alternatives = (Array.isArray(args.alternatives) ? (args.alternatives as Record<string, unknown>[]) : [])
            .map((a) => ({ rule: toSourced(input.province, String(a.rule_id || "")), when: String(a.when || ""), k: a.facility_kind }))
            .filter(
              (a): a is { rule: SourcedRule; when: string; k: unknown } =>
                !!a.rule &&
                seenRuleIds.has(a.rule.rule_id) &&
                a.rule.rule_id !== rule.rule_id &&
                a.rule.route !== "registry" &&
                !(blockPharmacist && a.rule.route === "pharmacist") &&
                !!a.when,
            )
            .slice(0, 3)
            .map((a) => ({ rule: a.rule, when: a.when, facility_kind: asKind(a.k) }))
            // preferredMode only ORDERS the options (stable sort); it never changes the main route.
            .sort((a, b) => prefers(b.rule.route) - prefers(a.rule.route));
          const guideUrl = String(args.guide_url || "");
          return applyEscalation({
            type: "route",
            language: lang(),
            need_type: needType,
            need_summary_en: need?.summary ?? "",
            rule,
            reason: String(args.reason || ""),
            message: String(args.message || ""),
            facility_kind: kind,
            facilities: facilities.slice(0, 5).map((f) => (waitById.has(f.id) ? { ...f, wait_minutes: waitById.get(f.id) } : f)),
            er_waits_source: waits?.available ? { name: waits.source_name!, url: waits.source_url!, refreshed_at: waits.refreshed_at! } : undefined,
            registry: registry && registry.rule_id !== rule.rule_id ? registry : undefined,
            alternatives,
            guide: guides.has(guideUrl) ? { title: guides.get(guideUrl)!, url: guideUrl } : undefined,
            booking_note: (String(args.booking_note_en || "") || need?.summary || "").slice(0, 300),
            no_guideline: false,
            escalated: false,
            call_911_if_worse: false,
            evidence: evidence.slice(0, 400),
            location_needed: locationNeeded && facilities.length === 0,
            debug: debugFor(rule.route),
          });
        }
        default:
          results.push(fail(`Unknown tool ${call.name}`));
      }
    }
    turns.push({ role: "tool_results", results });
  }
  return { type: "error", message: "The assistant took too many steps." };
}

