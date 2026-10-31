/** OpenAI adapter (Chat Completions + function calling, strict schemas). */
import OpenAI from "openai";
import type { Completion, LlmClient, ToolSpec, Turn } from "./types";
import { parseArgs } from "./types";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export function toOpenAiMessages(system: string, turns: Turn[]): Msg[] {
  const out: Msg[] = [{ role: "system", content: system }];
  for (const t of turns) {
    if (t.role === "user") out.push({ role: "user", content: t.text });
    else if (t.role === "assistant") {
      out.push({
        role: "assistant",
        content: t.text || null,
        ...(t.toolCalls.length
          ? { tool_calls: t.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })) }
          : {}),
      });
    } else {
      // One `tool` message per call, in order.
      for (const r of t.results) out.push({ role: "tool", tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
    }
  }
  return out;
}

export function toOpenAiTools(tools: ToolSpec[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters, strict: true } }));
}

export function openAiClient(model = process.env.OPENAI_MODEL || "gpt-5.5"): LlmClient {
  const client = new OpenAI(); // reads OPENAI_API_KEY
  return {
    provider: "openai",
    model,
    async complete({ system, tools, turns }): Promise<Completion> {
      const res = await client.chat.completions.create({
        model,
        messages: toOpenAiMessages(system, turns),
        tools: toOpenAiTools(tools),
        tool_choice: "auto",
        parallel_tool_calls: false, // keeps the safety re-check (record_need) strictly before other steps
        max_completion_tokens: 16000,
      });
      const choice = res.choices[0];
      const msg = choice?.message;
      const toolCalls = (msg?.tool_calls ?? [])
        .filter((c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === "function")
        .map((c) => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }));
      const stop: Completion["stop"] =
        choice?.finish_reason === "length" ? "max_tokens" : choice?.finish_reason === "content_filter" || msg?.refusal ? "refusal" : toolCalls.length ? "tool_use" : "end";
      return { text: msg?.content ?? "", toolCalls, stop };
    },
  };
}
