import { NextResponse } from "next/server";
import { listPersonas } from "@/lib/summary/personas";

export const runtime = "nodejs";

/** GET /api/personas – synthetic demo records the user can link to a household member. */
export async function GET() {
  return NextResponse.json(listPersonas());
}
