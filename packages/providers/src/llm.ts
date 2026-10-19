import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FactoryError } from "@ttm/core";
import type { ZodTypeAny, z } from "zod";

export type LlmRequest = { system: string; user: string; maxTokens?: number; temperature?: number };

export interface LlmProvider {
  readonly id: string;
  readonly configured: boolean;
  /** Estimated USD for a request; 0 for local providers. */
  estimateUsd(req: LlmRequest): number;
  completeJson<S extends ZodTypeAny>(req: LlmRequest, schema: S): Promise<z.output<S>>;
}

/** Runtime LLM not configured: never fabricates output (spec C: NEEDS_PROVIDER). */
export class NotConfiguredLlm implements LlmProvider {
  readonly id = "none";
  readonly configured = false;
  estimateUsd() {
    return 0;
  }
  async completeJson(_req?: LlmRequest, _schema?: unknown): Promise<never> {
    throw new FactoryError("NEEDS_PROVIDER", "HUMAN_REQUIRED", "Chưa cấu hình LLM runtime (LLM_BASE_URL/LLM_MODEL). Dùng kịch bản template xác định hoặc cấu hình Ollama/API riêng.", {
      nextAction: "Cài Ollama và đặt LLM_BASE_URL=http://127.0.0.1:11434/v1, LLM_MODEL=<model>",
    });
  }
}

/**
 * OpenAI-compatible chat endpoint (Ollama, LM Studio, vLLM, or a paid API with its own key).
 * Claude Code / Claude Max subscriptions are a development tool, not this runtime.
 * Responses are cached by request hash; JSON is schema-validated with bounded retries.
 */
export class OpenAiCompatibleLlm implements LlmProvider {
  readonly configured = true;
  constructor(
    private readonly opts: {
      id?: string;
      baseUrl: string;
      model: string;
      apiKey?: string;
      cacheDir: string;
      usdPer1kTokens?: number;
      budgetCheck?: (usd: number) => Promise<void>;
      fetchImpl?: typeof fetch;
      maxAttempts?: number;
    },
  ) {}
  get id() {
    return this.opts.id ?? `openai-compatible:${this.opts.model}`;
  }
  estimateUsd(req: LlmRequest) {
    const tokens = (req.system.length + req.user.length) / 3.5 + (req.maxTokens ?? 1200);
    return ((this.opts.usdPer1kTokens ?? 0) * tokens) / 1000;
  }
  async completeJson<S extends ZodTypeAny>(req: LlmRequest, schema: S): Promise<z.output<S>> {
    const key = createHash("sha256").update(JSON.stringify([this.opts.model, req])).digest("hex");
    const cacheFile = path.join(this.opts.cacheDir, `${key}.json`);
    try {
      const cached = schema.safeParse(JSON.parse(await fs.readFile(cacheFile, "utf8")));
      if (cached.success) return cached.data;
    } catch {
      /* miss */
    }
    const est = this.estimateUsd(req);
    if (est > 0 && this.opts.budgetCheck) await this.opts.budgetCheck(est);
    const f = this.opts.fetchImpl ?? fetch;
    let lastErr = "";
    for (let attempt = 1; attempt <= (this.opts.maxAttempts ?? 3); attempt++) {
      const res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.opts.model,
          temperature: req.temperature ?? 0.4,
          max_tokens: req.maxTokens ?? 1200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user + (lastErr ? `\n\nLần trước JSON không hợp lệ: ${lastErr}. Trả lại JSON đúng schema.` : "") },
          ],
        }),
      }).catch((e) => {
        throw new FactoryError("LLM_NETWORK", "RETRYABLE", `Không kết nối được LLM: ${e.message}`, { provider: this.id });
      });
      if (res.status === 429) throw new FactoryError("LLM_RATE_LIMIT", "RETRYABLE", "LLM bị giới hạn tốc độ (429)", { provider: this.id });
      if (!res.ok) throw new FactoryError("LLM_HTTP", res.status >= 500 ? "RETRYABLE" : "PERMANENT", `LLM HTTP ${res.status}`, { provider: this.id });
      const body: any = await res.json();
      const text: string = body?.choices?.[0]?.message?.content ?? "";
      if (body?.choices?.[0]?.finish_reason === "length") lastErr = "output bị cắt (truncated)";
      try {
        const parsed = schema.safeParse(JSON.parse(text));
        if (parsed.success) {
          await fs.mkdir(this.opts.cacheDir, { recursive: true });
          await fs.writeFile(cacheFile, JSON.stringify(parsed.data));
          return parsed.data;
        }
        lastErr = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 400);
      } catch (e: any) {
        lastErr = `JSON parse: ${e.message}`;
      }
    }
    throw new FactoryError("LLM_MALFORMED", "BLOCKED", `LLM trả JSON sai schema sau nhiều lần: ${lastErr}`, { provider: this.id });
  }
}

export function llmFromEnv(cacheDir: string, budgetCheck?: (usd: number) => Promise<void>): LlmProvider {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !model) return new NotConfiguredLlm();
  return new OpenAiCompatibleLlm({ baseUrl, model, apiKey: process.env.LLM_API_KEY, cacheDir, budgetCheck, usdPer1kTokens: Number(process.env.LLM_USD_PER_1K ?? 0) });
}
