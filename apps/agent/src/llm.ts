import fs from "node:fs";
import path from "node:path";
import type { AgentEnv } from "./env";
import prompts from "./prompts.json";

export type LlmResult = { text: string };

// ---------------------------------------------------------------------------
// LLM response cache — reads/writes apps/agent/src/llm-cache.json
// When INVOKE_LLM=0 (default), responses are served from cache.
// When INVOKE_LLM=1, API is called and responses are saved to cache.
// ---------------------------------------------------------------------------

const CACHE_PATH = path.resolve(__dirname, "../src/llm-cache.json");

type LlmCache = Record<string, string>;

function loadCache(): LlmCache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache: LlmCache): void {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

function getCached(key: string): string | undefined {
  return loadCache()[key];
}

function setCached(key: string, value: string): void {
  const cache = loadCache();
  cache[key] = value;
  saveCache(cache);
}

function renderFinal(humanAnswer: string): string {
  return prompts.finalStep.replace("{{humanAnswer}}", humanAnswer);
}

// ---------------------------------------------------------------------------
// Live LLM calls (raw fetch — no SDK dependencies)
// ---------------------------------------------------------------------------

async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.content[0].text;
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.candidates[0].content.parts[0].text;
}

async function callLlm(env: AgentEnv, prompt: string): Promise<string> {
  if (env.showPrompts) {
    console.log("\n[agent][prompt]\n" + prompt + "\n");
  }
  if (env.llmProvider === "anthropic") {
    if (!env.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set");
    return callAnthropic(env.anthropicApiKey, env.anthropicModel, prompt);
  }
  if (env.llmProvider === "gemini") {
    if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY not set");
    return callGemini(env.geminiApiKey, env.geminiModel, prompt);
  }
  if (!env.openaiApiKey) throw new Error("OPENAI_API_KEY not set");
  // OpenAI uses chat/completions here; model is configurable.
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.openaiModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.choices[0].message.content;
}

// ---------------------------------------------------------------------------
// Public step functions (cache-aware)
// ---------------------------------------------------------------------------

export async function cachedCallLlm(env: AgentEnv, key: string, prompt: string): Promise<string> {
  if (!env.invokeLlm) {
    const hit = getCached(key);
    if (hit) {
      console.log(`[agent] cache hit for "${key}"`);
      return hit;
    }
    throw new Error(`No cache entry for "${key}". Run with INVOKE_LLM=1 to populate.`);
  }
  const text = await callLlm(env, prompt);
  setCached(key, text);
  console.log(`[agent] cached response for "${key}"`);
  return text;
}

export async function runReasoningProbe(env: AgentEnv): Promise<LlmResult> {
  const text = await cachedCallLlm(env, "reasoningProbe", prompts.reasoningProbe);
  return { text };
}

export async function runStep1(env: AgentEnv): Promise<LlmResult> {
  const text = await cachedCallLlm(env, "step1", prompts.step1);
  return { text };
}

export async function runStep2(env: AgentEnv): Promise<LlmResult> {
  const text = await cachedCallLlm(env, "step2", prompts.step2);
  return { text };
}

export async function runAmbiguityCheck(env: AgentEnv): Promise<LlmResult> {
  const text = await cachedCallLlm(env, "ambiguityCheck", prompts.ambiguityCheck);
  return { text };
}

export function runFinalStep(_env: AgentEnv, humanAnswer: string): LlmResult {
  return { text: renderFinal(humanAnswer) };
}
