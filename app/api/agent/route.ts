import { NextResponse } from "next/server";
import { checkRedFlags } from "@/lib/safety/redFlags";

/**
 * POST /api/agent – scaffold.
 * Step 2 is already enforced here: red flags are checked BEFORE any model call.
 * The Claude tool-use loop is added in the next step.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; ageMonths?: number; checklist?: Record<string, boolean> };
  const flags = checkRedFlags({ text: body.text, ageMonths: body.ageMonths, checklist: body.checklist });
  if (flags.triggered) {
    return NextResponse.json({ type: "emergency", action: flags.action });
  }
  return NextResponse.json({ type: "not_implemented" }, { status: 501 });
}
