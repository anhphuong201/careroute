/**
 * Tools the model may call. Province and the user's location are injected by
 * the server, never trusted from the model.
 *
 * NOT exposed to the model:
 *  - check_red_flags  → always run by the server first (lib/safety/redFlags.ts),
 *                       and again on the model's English restatement (record_need).
 *  - book_appointment → only after the user taps "Yes, book" (/api/book).
 *  - build_summary    → only when the user asks for the PDF (/api/summary).
 */
import type Anthropic from "@anthropic-ai/sdk";

type Tool = Anthropic.Beta.BetaTool;

const obj = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

export const NEED_TYPES = ["prescription_renewal", "lab_followup", "minor_symptom", "find_doctor", "other"] as const;

export const TOOLS: Tool[] = [
  {
    name: "record_need",
    description:
      "ALWAYS call this first, exactly once. Restate the user's need in plain English (no diagnosis, no condition names unless the user named one), classify it, and record the language the user wrote in. The server re-screens your English restatement for emergency signs.",
    strict: true,
    input_schema: obj({
      detected_language: { type: "string", description: "BCP-47 code of the user's language, e.g. en, fr, zh, pa, vi, tl, ar, es." },
      need_summary_en: { type: "string", description: "One or two plain-English sentences describing what the user asked for, including any symptoms they mentioned, in their own terms." },
      need_type: { type: "string", enum: [...NEED_TYPES] },
      medication_mentioned: { type: "string", description: "Brand name or DIN if the user named a medication, else an empty string." },
    }),
  },
  {
    name: "search_care_rules",
    description:
      "Read the official care-navigation rules for the user's province. Returns rule texts, each with a rule_id, route and source_url. You must choose the route ONLY from these rules.",
    strict: true,
    input_schema: obj({
      need_type: { type: "string", enum: [...NEED_TYPES] },
      need_summary_en: { type: "string" },
    }),
  },
  {
    name: "lookup_medication",
    description:
      "Look up a medication in Health Canada's Drug Product Database: whether it is prescription-only and its active ingredients. Facts only – never give dosing or advice about taking it.",
    strict: true,
    input_schema: obj({ query: { type: "string", description: "Brand name or 8-digit DIN." } }),
  },
  {
    name: "find_facilities",
    description:
      "Find the nearest options for the chosen route, sorted by distance from the user's location (the server knows the location). kind=walk_in also returns urgent care centres and clinics whose walk-in status is unknown.",
    strict: true,
    input_schema: obj({
      kind: { type: "string", enum: ["pharmacy", "walk_in", "urgent_care"] },
      limit: { type: "integer", description: "1–10, default 5." },
    }),
  },
  {
    name: "check_er_waits",
    description:
      "Get official estimated wait times for urgent care centres / emergency departments in the province. Use only when the route is walk_in and urgent care options were returned.",
    strict: true,
    input_schema: obj({ facility_ids: { type: "array", items: { type: "string" } } }),
  },
  {
    name: "present_route",
    description:
      "Finish by calling this exactly once with your recommendation. The server attaches the rule's official source link and the facility details.",
    strict: true,
    input_schema: obj({
      rule_id: { type: "string", description: "rule_id from search_care_rules for the main route." },
      reason: { type: "string", description: "ONE plain-language sentence, in the user's language, saying why this route fits. No diagnosis, no condition names." },
      message: { type: "string", description: "Up to 3 short sentences in the user's language: what to do next and what to bring. Grade 6 reading level." },
      facility_kind: { type: "string", enum: ["pharmacy", "walk_in", "urgent_care", "none"] },
      facility_ids: { type: "array", items: { type: "string" }, description: "Up to 5 ids from find_facilities, best first. Empty if the route has no physical location (811, virtual care, registry, family doctor)." },
      registry_rule_id: { type: "string", description: "rule_id of the find-a-family-doctor rule when the person has no family doctor or it is hard to access, else an empty string." },
    }),
  },
  {
    name: "ask_clarifying_question",
    description: "Use instead of present_route ONLY if the request is too vague to choose any route. One short question in the user's language.",
    strict: true,
    input_schema: obj({ question: { type: "string" } }),
  },
];
