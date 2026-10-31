/**
 * Claude tool schemas (Anthropic Messages API `tools`).
 * check_red_flags is NOT exposed to the model as an optional tool: the server
 * always runs it first (lib/safety/redFlags.ts) and again on the model's
 * translation. Implementations of the tools below come in the next step.
 */
import type Anthropic from "@anthropic-ai/sdk";

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_care_rules",
    description:
      "Search the official care-navigation rules for the user's province. Returns rule snippets, each with its route and source_url. Use this to choose ONE route: pharmacist, virtual_care, walk_in, call_811, registry or family_doctor.",
    input_schema: {
      type: "object",
      properties: {
        province: { type: "string", enum: ["AB", "BC"] },
        need_summary_en: { type: "string", description: "The user's need restated in plain English, with no diagnosis." },
        age_group: { type: "string", enum: ["infant", "child", "adult"] },
        has_family_doctor: { type: "string", enum: ["yes", "no", "hard_to_access"] },
      },
      required: ["province", "need_summary_en", "age_group", "has_family_doctor"],
    },
  },
  {
    name: "find_facilities",
    description: "Find nearby clinics or pharmacies for the chosen route, sorted by distance.",
    input_schema: {
      type: "object",
      properties: {
        province: { type: "string", enum: ["AB", "BC"] },
        kind: { type: "string", enum: ["pharmacy", "walk_in", "urgent_care", "emergency", "any"] },
        lat: { type: "number" },
        lng: { type: "number" },
        limit: { type: "integer", default: 5 },
      },
      required: ["province", "kind"],
    },
  },
  {
    name: "check_er_waits",
    description: "Get official estimated ER wait times for the province. Never call this if red flags matched.",
    input_schema: {
      type: "object",
      properties: { province: { type: "string", enum: ["AB", "BC"] }, facility_ids: { type: "array", items: { type: "string" } } },
      required: ["province"],
    },
  },
  {
    name: "book_appointment",
    description: "SIMULATED booking. Only call after the user has explicitly approved a specific option.",
    input_schema: {
      type: "object",
      properties: {
        facility_id: { type: "string" },
        member_id: { type: "string" },
        user_approved: { type: "boolean", const: true },
      },
      required: ["facility_id", "member_id", "user_approved"],
    },
  },
  {
    name: "build_summary",
    description: "Create a one-page PDF health summary from the member's persona record, for the user to bring to a visit.",
    input_schema: {
      type: "object",
      properties: { persona_id: { type: "string" }, language: { type: "string" } },
      required: ["persona_id"],
    },
  },
];
