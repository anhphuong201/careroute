/**
 * Follow-up fact registry. Rules list the facts they need (`required_facts` in front-matter);
 * the agent picks a fact id, the UI shows the fixed question + tap answers from lib/i18n.ts.
 * The model never writes the question text.
 */

export type FactAnswerType = "choice" | "text";

export interface FactDef {
  id: FactId;
  type: FactAnswerType;
  /** Allowed answers for "choice" facts. "not_sure" is always included and always allowed. */
  options: readonly string[];
  /** Max length for "text" facts. */
  maxLength?: number;
  /** When the agent may ask it even if no rule lists it (situational facts). Shown to the model. */
  relevantWhen?: string;
}

export const FACT_IDS = [
  "temperature_c",
  "drinking_and_peeing_normally",
  "medication_name",
  "runs_out_when",
  "is_controlled_drug",
  "lab_ordered_by",
  "lab_flagged_abnormal",
  "can_bear_weight_or_use",
  "could_be_pregnant",
] as const;
export type FactId = (typeof FACT_IDS)[number];

const YES_NO = ["yes", "no", "not_sure"] as const;

export const FACTS: Record<FactId, FactDef> = {
  temperature_c: {
    id: "temperature_c",
    type: "choice",
    options: ["below_38", "38_to_38_9", "39_to_39_9", "40_or_higher", "not_sure"],
    relevantWhen: "the person mentions fever, feeling hot or chills",
  },
  drinking_and_peeing_normally: {
    id: "drinking_and_peeing_normally",
    type: "choice",
    options: YES_NO,
    relevantWhen: "a child or baby has fever, vomiting or diarrhea",
  },
  medication_name: { id: "medication_name", type: "text", options: ["not_sure"], maxLength: 60 },
  runs_out_when: { id: "runs_out_when", type: "choice", options: ["already_out", "within_3_days", "within_2_weeks", "later", "not_sure"] },
  is_controlled_drug: { id: "is_controlled_drug", type: "choice", options: YES_NO },
  lab_ordered_by: { id: "lab_ordered_by", type: "choice", options: ["family_doctor", "walk_in", "specialist", "not_sure"] },
  lab_flagged_abnormal: { id: "lab_flagged_abnormal", type: "choice", options: YES_NO },
  can_bear_weight_or_use: {
    id: "can_bear_weight_or_use",
    type: "choice",
    options: YES_NO,
    relevantWhen: "the person describes an injury to an arm, leg, hand, foot or joint",
  },
  could_be_pregnant: {
    id: "could_be_pregnant",
    type: "choice",
    options: YES_NO,
    relevantWhen: "only when pregnancy changes which service can help (e.g. some pharmacist prescribing, urinary symptoms, certain medicines)",
  },
};

export const isFactId = (v: unknown): v is FactId => typeof v === "string" && (FACT_IDS as readonly string[]).includes(v);

export type FactAnswers = Partial<Record<FactId, string>>;

/** Validate one answer against the registry. Returns the clean value or null. */
export function validateFactAnswer(id: FactId, value: unknown): string | null {
  const def = FACTS[id];
  if (typeof value !== "string") return null;
  if (value === "not_sure") return value;
  if (def.type === "choice") return def.options.includes(value) ? value : null;
  // text: strip control characters and angle brackets, collapse spaces, cap length
  const clean = value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, def.maxLength ?? 60);
  return clean || null;
}

/** Clean a whole answers object (unknown keys and bad values are dropped). */
export function validateFactAnswers(input: unknown): FactAnswers {
  const out: FactAnswers = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isFactId(k)) continue;
    const ok = validateFactAnswer(k, v);
    if (ok !== null) out[k] = ok;
  }
  return out;
}

/** A follow-up the person has already answered, and the route the agent was leaning to when it asked. */
export interface FollowUp {
  fact_id: FactId;
  likely_route: string;
}

/** Facts given as answers are "known" even when the answer is "not sure". */
export const knownFacts = (answers: FactAnswers, fromText: string[] = []) => new Set<string>([...Object.keys(answers), ...fromText.filter(isFactId)]);

/** Plain lines for the model, e.g. "runs_out_when: within_3_days". */
export function factLines(answers: FactAnswers): string[] {
  return (Object.entries(answers) as [FactId, string][]).map(([k, v]) => `${k}: ${v}`);
}

export const MAX_FOLLOW_UPS = 2;
