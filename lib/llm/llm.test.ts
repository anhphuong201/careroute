import { describe, expect, it } from "vitest";
import { selectProvider } from "./index";
import { toOpenAiMessages, toOpenAiTools } from "./openai";
import { toAnthropicMessages } from "./anthropic";
import { TOOLS } from "../tools/definitions";
import type { Turn } from "./types";

const turns: Turn[] = [
  { role: "user", text: "need a refill" },
  { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "record_need", input: { need_type: "prescription_renewal" } }] },
  { role: "tool_results", results: [{ id: "c1", content: '{"recorded":true}' }] },
];

describe("provider selection", () => {
  it("prefers OpenAI when its key is set", () => {
    expect(selectProvider({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "y" })).toBe("openai");
  });
  it("respects LLM_PROVIDER", () => {
    expect(selectProvider({ LLM_PROVIDER: "anthropic", OPENAI_API_KEY: "x" })).toBe("anthropic");
  });
  it("falls back to Anthropic, then to none", () => {
    expect(selectProvider({ ANTHROPIC_API_KEY: "y" })).toBe("anthropic");
    expect(selectProvider({})).toBeNull();
  });
});

describe("OpenAI adapter", () => {
  it("maps turns to chat messages with tool calls and tool results", () => {
    const m = toOpenAiMessages("SYS", turns);
    expect(m[0]).toEqual({ role: "system", content: "SYS" });
    expect(m[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "record_need" } }] });
    expect(m[3]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"recorded":true}' });
  });
  it("sends every tool as a strict function whose schema lists all properties as required", () => {
    for (const t of toOpenAiTools(TOOLS)) {
      if (t.type !== "function") throw new Error("expected function tool");
      expect(t.function.strict).toBe(true);
      const p = t.function.parameters as { properties: object; required: string[]; additionalProperties: boolean };
      expect(p.additionalProperties).toBe(false);
      expect(p.required.sort()).toEqual(Object.keys(p.properties).sort());
    }
  });
});

describe("Anthropic adapter", () => {
  it("maps tool results to a user turn of tool_result blocks", () => {
    const m = toAnthropicMessages(turns);
    expect(m[2]).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "c1" }] });
  });
});
