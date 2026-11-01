/**
 * Tools the model may call (provider-neutral; see lib/llm/*). Province and the user's location are injected by
 * the server, never trusted from the model.
 *
 * NOT exposed to the model:
 *  - check_red_flags  → always run by the server first (lib/safety/redFlags.ts),
 *                       and again on the model's English restatement (record_need).
 *  - book_appointment → only after the user taps "Yes, book" (/api/book).
 *  - build_summary    → only when the user asks for the PDF (/api/summary).
 */
import type { ToolSpec } from "../llm/types";

type Tool = ToolSpec;

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
    parameters: obj({
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
    parameters: obj({
      need_type: { type: "string", enum: [...NEED_TYPES] },
      need_summary_en: { type: "string" },
    }),
  },
  {
    name: "lookup_medication",
    description:
      "Look up a medication in Health Canada's Drug Product Database: whether it is prescription-only and its active ingredients. Facts only – never give dosing or advice about taking it.",
    parameters: obj({ query: { type: "string", description: "Brand name or 8-digit DIN." } }),
  },
  {
    name: "symptom_guide",
    description:
      "Look up HealthLink BC's official symptom guide for a symptom the user described. Returns the guide's questions – the extra symptoms or situations that change what care is needed (e.g. 'Do you have a fever, chills or vomiting?') – and its URL. Use it to write the 'when' text for alternatives. Query with 1–3 plain health-guide words, e.g. 'constipation', 'sore throat', 'urinary problems', 'skin rash', 'cough', 'ear problems', 'headache', 'back pain', 'eye problems'.",
    parameters: obj({ query: { type: "string" } }),
  },
  {
    name: "find_facilities",
    description:
      "Find options for the chosen route. pharmacy / walk_in / urgent_care are sorted by distance from the user's location (the server knows it); walk_in also returns urgent care centres and clinics whose walk-in status is unknown. kind=virtual returns the province's phone/video care services (official ones first).",
    parameters: obj({
      kind: { type: "string", enum: ["pharmacy", "walk_in", "urgent_care", "virtual"] },
      limit: { type: "integer", description: "1–10, default 5." },
    }),
  },
  {
    name: "check_er_waits",
    description:
      "Get official estimated wait times for urgent care centres / emergency departments in the province. Use only when the route is walk_in and urgent care options were returned.",
    parameters: obj({ facility_ids: { type: "array", items: { type: "string" } } }),
  },
  {
    name: "present_route",
    description:
      "Finish by calling this exactly once with your recommendation. The server attaches the rule's official source link and the facility details.",
    parameters: obj({
      rule_id: { type: "string", description: "rule_id from search_care_rules for the main route." },
      reason: { type: "string", description: "ONE plain-language sentence, in the user's language, saying why this route fits. No diagnosis, no condition names." },
      message: { type: "string", description: "Up to 3 short sentences in the user's language: what to do next and what to bring. Grade 6 reading level." },
      facility_kind: { type: "string", enum: ["pharmacy", "walk_in", "urgent_care", "virtual", "none"] },
      facility_ids: { type: "array", items: { type: "string" }, description: "Up to 5 ids from find_facilities, best first. Empty for 811, registry and family doctor routes." },
      registry_rule_id: { type: "string", description: "rule_id of the find-a-family-doctor rule when the person has no family doctor or it is hard to access, else an empty string." },
      alternatives: {
        type: "array",
        description:
          "1–3 other options, each with WHEN to choose it instead, in the user's language. Base 'when' on the rule text and on symptom_guide questions (e.g. 'If you also have belly pain, fever, blood in your stool, or it has not improved after a week of home care, see a doctor: virtual care or a walk-in clinic.'). Always include a safer step up (walk-in/urgent care or 811) when the main route is pharmacist.",
        items: obj({
          rule_id: { type: "string", description: "rule_id from search_care_rules." },
          when: { type: "string", description: "One sentence starting with 'If …', in the user's language." },
          facility_kind: { type: "string", enum: ["pharmacy", "walk_in", "urgent_care", "virtual", "none"] },
        }),
      },
      guide_url: { type: "string", description: "URL returned by symptom_guide if you used it, else an empty string." },
      booking_note_en: {
        type: "string",
        description:
          "Reason for visit to paste into a booking form or say on the phone, in plain ENGLISH, max 2 short sentences: the person's symptoms or need in their own terms and how long. No diagnosis, no names, no health card or other identifiers. E.g. 'Burning when urinating for 2 days. No fever.'",
      },
    }),
  },
  {
    name: "ask_clarifying_question",
    description: "Use instead of present_route ONLY if the request is too vague to choose any route. One short question in the user's language.",
    parameters: obj({ question: { type: "string" } }),
  },
];
