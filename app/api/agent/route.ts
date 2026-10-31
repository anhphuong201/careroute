import { NextResponse } from "next/server";
import { runAgent, type AgentInput } from "@/lib/agent/runAgent";
import { PROVINCES } from "@/lib/provinces";
import type { RedFlagCategory } from "@/lib/safety/redFlags";

export const runtime = "nodejs";
export const maxDuration = 60;

const AGE_GROUPS = ["infant", "child", "adult"] as const;
const DOCTOR = ["yes", "no", "hard_to_access"] as const;
const FLAGS: RedFlagCategory[] = ["chest_pain", "breathing", "stroke_signs", "severe_bleeding", "suicidal_thoughts", "infant_fever"];

/** POST /api/agent – nothing from the request is stored server-side. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ type: "error", message: "bad_request" }, { status: 400 });

  const province = String(b.province) as AgentInput["province"];
  if (!(province in PROVINCES)) return NextResponse.json({ type: "error", message: "bad_province" }, { status: 400 });
  const loc = b.location as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  const checklistIn = (b.checklist ?? {}) as Record<string, unknown>;

  const input: AgentInput = {
    province,
    text: String(b.text ?? "").slice(0, 4000),
    ageGroup: AGE_GROUPS.includes(b.ageGroup as never) ? (b.ageGroup as AgentInput["ageGroup"]) : "adult",
    ageMonths: Number.isFinite(Number(b.ageMonths)) && b.ageMonths !== null && b.ageMonths !== "" ? Number(b.ageMonths) : undefined,
    hasFamilyDoctor: DOCTOR.includes(b.hasFamilyDoctor as never) ? (b.hasFamilyDoctor as AgentInput["hasFamilyDoctor"]) : "no",
    checklist: Object.fromEntries(FLAGS.map((f) => [f, checklistIn[f] === true])),
    location: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    city: typeof b.city === "string" ? b.city.slice(0, 60) : undefined,
  };

  try {
    return NextResponse.json(await runAgent(input));
  } catch (e) {
    console.error("agent error", e instanceof Error ? e.message : e);
    const noKey = !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
    return NextResponse.json({ type: "error", message: noKey ? "missing_api_key" : "agent_failed" }, { status: 500 });
  }
}
