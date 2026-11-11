import { NextResponse } from "next/server";
import { runAgent, type AgentInput } from "@/lib/agent/runAgent";
import { MissingApiKeyError } from "@/lib/llm";
import { PROVINCES } from "@/lib/provinces";
import type { RedFlagCategory } from "@/lib/safety/redFlags";
import { COVERAGES, DURATIONS, HIGHER_RISK, PREFERRED_MODES, SEVERITIES, TRENDS, isOneOf, parseAgeMonths } from "@/lib/intake";
import { MAX_FOLLOW_UPS, isFactId, validateFactAnswers, type FollowUp } from "@/lib/facts";
import { ROUTES } from "@/lib/tools/definitions";

export const runtime = "nodejs";
export const maxDuration = 60;

const AGE_GROUPS = ["infant", "child", "adult"] as const;
const DOCTOR = ["yes", "no", "hard_to_access"] as const;
const FLAGS: RedFlagCategory[] = ["chest_pain", "breathing", "stroke_signs", "severe_bleeding", "suicidal_thoughts", "infant_fever"];

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => (isOneOf(list, v) ? v : undefined);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Follow-ups already asked: known fact ids only, no repeats, at most 2. */
function parseFollowUps(v: unknown): FollowUp[] {
  const out: FollowUp[] = [];
  for (const f of Array.isArray(v) ? v : []) {
    const o = obj(f);
    if (!isFactId(o.fact_id) || out.some((x) => x.fact_id === o.fact_id)) continue;
    out.push({ fact_id: o.fact_id, likely_route: pick(ROUTES, o.likely_route) ?? "call_811" });
  }
  return out.slice(0, MAX_FOLLOW_UPS);
}

/** POST /api/agent – nothing from the request is stored server-side or logged (no answer values). */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ type: "error", message: "bad_request" }, { status: 400 });

  const province = String(b.province) as AgentInput["province"];
  if (!(province in PROVINCES)) return NextResponse.json({ type: "error", message: "bad_province" }, { status: 400 });
  const loc = b.location as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  const checklistIn = (b.checklist ?? {}) as Record<string, unknown>;
  // A wrong age must never be dropped silently: it drives the infant-fever red flag.
  const age = parseAgeMonths(b.ageMonths);
  if (!age.ok) return NextResponse.json({ type: "error", message: "bad_age" }, { status: 400 });

  const input: AgentInput = {
    province,
    text: String(b.text ?? "").slice(0, 4000),
    ageGroup: AGE_GROUPS.includes(b.ageGroup as never) ? (b.ageGroup as AgentInput["ageGroup"]) : "adult",
    ageMonths: age.value,
    hasFamilyDoctor: DOCTOR.includes(b.hasFamilyDoctor as never) ? (b.hasFamilyDoctor as AgentInput["hasFamilyDoctor"]) : "no",
    checklist: Object.fromEntries(FLAGS.map((f) => [f, checklistIn[f] === true])),
    location: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    city: typeof b.city === "string" ? b.city.slice(0, 60) : undefined,
    intake: {
      trend: pick(TRENDS, obj(b.intake).trend),
      severity: pick(SEVERITIES, obj(b.intake).severity),
      duration: pick(DURATIONS, obj(b.intake).duration),
    },
    profile: {
      coverage: pick(COVERAGES, obj(b.profile).coverage),
      higherRisk: pick(HIGHER_RISK, obj(b.profile).higherRisk),
      preferredMode: pick(PREFERRED_MODES, obj(b.profile).preferredMode),
    },
    facts: validateFactAnswers(b.facts),
    followUps: parseFollowUps(b.followUps),
  };

  try {
    return NextResponse.json(await runAgent(input));
  } catch (e) {
    console.error("agent error", e instanceof Error ? e.message : e);
    const status = (e as { status?: number }).status;
    const message = e instanceof MissingApiKeyError ? "missing_api_key" : status === 401 ? "invalid_api_key" : status === 429 ? "rate_limited" : "agent_failed";
    return NextResponse.json({ type: "error", message }, { status: 500 });
  }
}
