import type { AgentEnv } from "./env";

export type LlmResult = { text: string };

// ---------------------------------------------------------------------------
// Cached outputs for DEMO_CACHE mode (no API key required)
// ---------------------------------------------------------------------------

const CACHED_REASONING_PROBE = `Reasoning Probe (Fintech Risk Check):
{
  "candidates": [
    { "name": "A", "monthlyIncome": 8000, "monthlyDebt": 1800, "dti": 0.225, "notes": ["low DTI", "healthy buffer"] },
    { "name": "B", "monthlyIncome": 5400, "monthlyDebt": 2600, "dti": 0.481, "notes": ["high DTI", "tight cashflow"] },
    { "name": "C", "monthlyIncome": 9500, "monthlyDebt": 4100, "dti": 0.432, "notes": ["moderate-high DTI", "higher income helps"] }
  ],
  "decision": "A",
  "rationale": [
    "A has the lowest debt-to-income ratio and best affordability margin.",
    "B is above typical underwriting DTI thresholds and is riskiest.",
    "C is viable but still materially higher DTI than A."
  ],
  "confidence": 0.78
}`;

const CACHED_STEP1 = `Landing Page A Analysis:
  - Clean minimalist layout with strong visual hierarchy
  - Clear CTA button above the fold
  - Trust indicators (security badges, partner logos) visible
  - Potential issue: onboarding form has 6 fields - may cause drop-off
  - Color palette is professional but could feel cold to younger demographics`;

const CACHED_STEP2 = `Landing Page B Analysis:
  - Bold, modern design with animated micro-interactions
  - Progressive disclosure - starts with email-only, expands after
  - Social proof section with real user testimonials
  - Potential issue: heavy animations may hurt performance on mobile
  - Warmer color palette, feels more approachable`;

const CACHED_AMBIGUITY = `Both pages have clear strengths. Page A optimizes for trust and information density. Page B optimizes for engagement and progressive onboarding.

I cannot confidently determine which provides better UX without human visual judgment - the trade-off between "trust-first" and "engagement-first" depends on subjective design perception that I may hallucinate on.

-> Escalating to human resolver with both screenshots for side-by-side comparison.`;

function cachedFinal(humanAnswer: string): string {
  return `Final Analysis (incorporating human feedback):

Human resolver's assessment: "${humanAnswer}"

Recommendation: Based on the LLM analysis of both pages' structural strengths combined with the human resolver's visual/UX judgment, the preferred landing page has been identified. The agent can now proceed with the workflow using this validated decision.

Cost: 0.05 SOL bounty paid to human resolver.
Result: Avoided potential hallucination on subjective visual comparison.`;
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
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );
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

export async function runReasoningProbe(env: AgentEnv): Promise<LlmResult> {
  if (env.demoCache) return { text: CACHED_REASONING_PROBE };
  const prompt =
    "You are a fintech risk analyst. Solve this underwriting reasoning check.\n\n" +
    "Three candidates want the same $10k personal loan. Compute monthly income, DTI, and pick the safest.\n" +
    "- Candidate A: income $96,000/yr, monthly debt payments $1,800\n" +
    "- Candidate B: income $64,800/yr, monthly debt payments $2,600\n" +
    "- Candidate C: income $114,000/yr, monthly debt payments $4,100\n\n" +
    "Return ONLY JSON with this shape:\n" +
    "{\n" +
    '  "candidates":[{"name":"A","monthlyIncome":number,"monthlyDebt":number,"dti":number,"notes":[string]}],\n' +
    '  "decision":"A|B|C",\n' +
    '  "rationale":[string],\n' +
    '  "confidence":number\n' +
    "}\n" +
    "Use dti = monthlyDebt/monthlyIncome rounded to 3 decimals. Confidence 0..1.\n";
  const text = await callLlm(env, prompt);
  return { text };
}

export async function runStep1(env: AgentEnv): Promise<LlmResult> {
  if (env.demoCache) return { text: CACHED_STEP1 };
  const text = await callLlm(
    env,
    "You are a UX analyst. Analyze the strengths and weaknesses of a fintech onboarding " +
      "landing page (Page A). It has a clean minimalist layout, a clear CTA above the fold, " +
      "security badges, but a 6-field form. Keep your analysis to 5 bullet points."
  );
  return { text };
}

export async function runStep2(env: AgentEnv): Promise<LlmResult> {
  if (env.demoCache) return { text: CACHED_STEP2 };
  const text = await callLlm(
    env,
    "You are a UX analyst. Analyze the strengths and weaknesses of a fintech onboarding " +
      "landing page (Page B). It has bold modern design with micro-interactions, progressive " +
      "disclosure starting with email-only, user testimonials, but heavy animations. " +
      "Keep your analysis to 5 bullet points."
  );
  return { text };
}

export async function runAmbiguityCheck(env: AgentEnv): Promise<LlmResult> {
  if (env.demoCache) return { text: CACHED_AMBIGUITY };
  const text = await callLlm(
    env,
    "You analyzed two landing pages. Page A: trust-focused, clean, 6-field form. " +
      "Page B: engagement-focused, progressive disclosure, heavy animations. " +
      "You cannot confidently pick which has better UX without human visual judgment. " +
      "Explain why you're escalating to a human resolver. Keep it to 3 short paragraphs."
  );
  return { text };
}

export function runFinalStep(_env: AgentEnv, humanAnswer: string): LlmResult {
  return { text: cachedFinal(humanAnswer) };
}
