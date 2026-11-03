export type AiProvider = { apiKey: string; base: string; model: string };

export function getAiProvider(): AiProvider | null {
  const apiKey = process.env.AI_API_KEY || process.env.GROQ_API_KEY;
  const base = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1";
  const model = process.env.AI_MODEL || "llama-3.3-70b-versatile";
  try {
    const url = new URL(base);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) || url.username || url.password) return null;
  } catch {
    return null;
  }
  return apiKey ? { apiKey, base: base.replace(/\/$/, ""), model } : null;
}

export async function completeWithAi(provider: AiProvider, system: string, user: string, maxTokens = 1_200): Promise<string> {
  const response = await fetch(`${provider.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.15,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw Object.assign(new Error(response.status === 429 ? "The AI provider is rate limited. Try again shortly." : "The configured AI provider could not answer this request."), { status: response.status === 429 ? 503 : 502 });
  }
  const data = await response.json() as { choices?: { message?: { content?: string | null } }[] };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw Object.assign(new Error("The AI provider returned an empty answer."), { status: 502 });
  return answer.slice(0, 20_000);
}
