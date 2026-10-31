/** Claude adapter (Messages API, manual tool loop). Used when LLM_PROVIDER=anthropic. */
import Anthropic from "@anthropic-ai/sdk";
import type { Completion, LlmClient, ToolSpec, Turn } from "./types";

type Msg = Anthropic.Beta.BetaMessageParam;

export function toAnthropicMessages(turns: Turn[]): Msg[] {
  return turns.map((t): Msg => {
    if (t.role === "user") return { role: "user", content: t.text };
    if (t.role === "assistant")
      // Send Claude's own content back unchanged (thinking blocks must be preserved).
      return {
        role: "assistant",
        content: (t.raw as Anthropic.Beta.BetaContentBlock[] | undefined) ?? [
          ...(t.text ? [{ type: "text" as const, text: t.text }] : []),
          ...t.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input })),
        ],
      };
    return {
      role: "user",
      content: t.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
    };
  });
}

export function toAnthropicTools(tools: ToolSpec[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, strict: true, input_schema: t.parameters as Anthropic.Beta.BetaTool["input_schema"] }));
}

export function anthropicClient(model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5"): LlmClient {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return {
    provider: "anthropic",
    model,
    async complete({ system, tools, turns }): Promise<Completion> {
      const res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: toAnthropicTools(tools),
        tool_choice: { type: "auto" },
        messages: toAnthropicMessages(turns),
      });
      const toolCalls = res.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const stop: Completion["stop"] =
        res.stop_reason === "refusal" ? "refusal" : res.stop_reason === "max_tokens" ? "max_tokens" : toolCalls.length ? "tool_use" : "end";
      return { text, toolCalls, stop, raw: res.content };
    },
  };
}
