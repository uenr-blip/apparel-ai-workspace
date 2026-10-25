import { PLATFORM_RULES } from "@/server/context/platform";
import { z } from "zod";
import { agentConfig } from "@/lib/agent-config";

export type AgentTool = { name: string; description: string; parameters: Record<string, unknown>; run: (args: unknown) => Promise<unknown> };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type AgentMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
export type Completion = (messages: AgentMessage[], tools: AgentTool[]) => Promise<{ content: string | null; tool_calls?: ToolCall[] }>;
const Reply = z.object({ content: z.string().max(16000).nullable().optional(), tool_calls: z.array(z.object({ id: z.string().min(1).max(200), type: z.literal("function"), function: z.object({ name: z.string().max(80), arguments: z.string().max(32000) }) })).max(6).nullish() });

export function completionFor(c: ReturnType<typeof agentConfig>, options: { maxTokens?: number } = {}): Completion {
  return async (messages, tools) => {
  if (c.mode !== "live") throw new Error("当前为本地验证模式，未调用真实模型");
  if (!c.apiKey) throw new Error(`智能体待配置：请在 .env 填写 ${c.keyName} 后重启`);
  const url = new URL(c.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("模型地址配置不正确，需要 HTTPS 服务地址");
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 25000);
  try {
    const response = await fetch(`${c.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal: abort.signal, redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model, messages, tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: "auto", max_tokens: options.maxTokens ?? 2000, ...(c.provider === "bailian" ? { enable_thinking: false } : c.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}) }),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? `模型鉴权失败：请核对${c.provider === "deepseek" ? "DeepSeek" : "百炼北京地域"}密钥和模型权限` : `模型服务暂不可用（${response.status}），未执行写入`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("模型未返回内容");
    let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength; if (size > 256000) { await reader.cancel(); throw new Error("模型回复过长，请缩小问题范围"); } chunks.push(r.value); } } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const reply = Reply.parse(body.choices?.[0]?.message);
    return { content: reply.content ?? null, tool_calls: reply.tool_calls ?? undefined };
  } catch (e) {
    if (abort.signal.aborted) throw new Error("模型响应超时，尚未执行写入，请稍后重试");
    if (e instanceof z.ZodError || e instanceof SyntaxError) throw new Error("模型回复格式不正确，尚未执行写入");
    // Never expose transport headers, credentials or provider response bodies.
    if (e instanceof TypeError) throw new Error("无法连接模型服务，请检查网络和模型地址");
    throw e;
  } finally { clearTimeout(timer); }
  };
}
export const liveCompletion: Completion = (messages, tools) => completionFor(agentConfig())(messages, tools);

export async function runToolLoop(input: { text: string; instructions: string; tools: AgentTool[]; completion?: Completion; maxRounds?: 4 | 6; incompleteEvidence?: () => string | null }) {
  const messages: AgentMessage[] = [
    { role: "system", content: `${PLATFORM_RULES}${input.instructions}` },
    { role: "user", content: input.text },
  ];
  const trace: Array<{ tool: string; label: string; result: unknown }> = [], ids = new Set<string>();
  for (let round = 0; round < (input.maxRounds ?? 4); round++) {
    const reply = await (input.completion ?? liveCompletion)(messages, input.tools);
    const calls = reply.tool_calls ?? [];
    if (!calls.length) {
      if (!trace.length) throw new Error("模型没有查询业务依据，请重试并写清客户、订单号或款号");
      const missing = input.incompleteEvidence?.();
      if (missing) {
        messages.push({ role: "assistant", content: reply.content ?? "" });
        messages.push({ role: "system", content: missing });
        continue;
      }
      return { answer: reply.content || "已查到下方业务依据，请核对候选和缺项。", trace };
    }
    if (trace.length + calls.length > 8) throw new Error("本次查询步骤过多，请缩小问题范围");
    // Validate the whole batch before executing any tool, even though current tools are read-only.
    for (const call of calls) {
      if (ids.has(call.id) || !input.tools.some(t => t.name === call.function.name)) throw new Error("模型请求了未授权工具，已停止处理");
      ids.add(call.id);
    }
    messages.push({ role: "assistant", content: reply.content, tool_calls: calls });
    for (const call of calls) {
      const tool = input.tools.find(t => t.name === call.function.name)!;
      let args: unknown; try { args = JSON.parse(call.function.arguments); } catch { throw new Error("模型工具参数无效，请重试"); }
      const result = await tool.run(args);
      const serialized = JSON.stringify(result);
      if (serialized.length > 45000) throw new Error("查询结果过多，请缩小范围");
      trace.push({ tool: tool.name, label: tool.description, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: serialized });
    }
  }
  throw new Error("模型未在限定步骤内完成，尚未执行写入，请缩小问题范围");
}
