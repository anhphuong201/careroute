/**
 * Structured intake – shared by the UI, the API route (allow-lists) and the agent.
 * Principle: only ask a question if its answer can change the route.
 */
import type { AgeGroup } from "./types";

export const TRENDS = ["worse", "same", "better"] as const;
export type Trend = (typeof TRENDS)[number];

export const SEVERITIES = ["mild", "moderate", "severe"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DURATIONS = ["today", "1_3_days", "4_7_days", "1_2_weeks", "over_2_weeks"] as const;
export type DurationBucket = (typeof DURATIONS)[number];

export const COVERAGES = ["has_health_card", "waiting_for_coverage", "no_coverage"] as const;
export type Coverage = (typeof COVERAGES)[number];

export const HIGHER_RISK = ["yes", "no", "prefer_not"] as const;
export type HigherRisk = (typeof HIGHER_RISK)[number];

export const PREFERRED_MODES = ["in_person", "virtual", "phone"] as const;
export type PreferredMode = (typeof PREFERRED_MODES)[number];

export interface CoreIntake {
  trend?: Trend;
  severity?: Severity;
  duration?: DurationBucket;
}

export interface ProfileIntake {
  coverage?: Coverage;
  higherRisk?: HigherRisk;
  preferredMode?: PreferredMode;
}

export const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** Whole months between birth date and `now` (null if invalid / in the future). */
export function monthsFromBirthDate(birthDate: string | undefined, now = new Date()): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime()) || b.getTime() > now.getTime()) return null;
  let m = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) m -= 1;
  return Math.max(0, m);
}

/** Age group kept for backward compatibility: under 1 = infant, 1–17 = child, 18+ = adult. */
export function ageGroupFromMonths(months: number | null | undefined, fallback: AgeGroup = "adult"): AgeGroup {
  if (typeof months !== "number" || !Number.isFinite(months)) return fallback;
  if (months < 12) return "infant";
  if (months < 18 * 12) return "child";
  return "adult";
}

export function describeAge(months: number): string {
  if (months < 24) return `${months} month${months === 1 ? "" : "s"} old`;
  return `${Math.floor(months / 12)} years old`;
}

/** Under 18: exact months when known, else the age group. */
export const isUnder18 = (ageMonths: number | undefined, ageGroup: AgeGroup) =>
  typeof ageMonths === "number" ? ageMonths < 18 * 12 : ageGroup !== "adult";

/** Core taps required for new / minor symptom requests (optional for renewals and lab follow-up). */
export const INTAKE_FIELDS = ["severity", "trend", "duration"] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];
export const missingIntake = (c: CoreIntake): IntakeField[] => INTAKE_FIELDS.filter((f) => !c[f]);

/**
 * Deterministic escalation (not AI): severe AND getting worse must never end at a
 * pharmacist or the registry.
 */
export const needsEscalation = (c: CoreIntake) => c.severity === "severe" && c.trend === "worse";

/**
 * Age in months: a number or a numeric string ("2" → 2). Missing / null / "" = unknown.
 * Anything else (non-numeric, negative, over 130 years) is a bad request – never silently dropped.
 */
export function parseAgeMonths(v: unknown): { ok: true; value: number | undefined } | { ok: false } {
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 130 * 12) return { ok: false };
  return { ok: true, value: Math.floor(n) };
}

