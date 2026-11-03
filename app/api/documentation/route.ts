import { completeWithAi, getAiProvider } from "@/lib/ai";
import { generateDocumentation, type DocumentationKind } from "@/lib/documentation";
import { allowRequest, rateLimitResponse } from "@/lib/rate-limit";
import type { RepositoryAnalysis } from "@/lib/types";

const kinds = new Set<DocumentationKind>(["readme", "architecture", "api", "database", "setup", "onboarding", "module", "environment"]);

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!allowRequest(request, "documentation", 10)) return rateLimitResponse();
  try {
    const raw = await request.text();
    if (raw.length > 200_000) return Response.json({ error: "Documentation request is too large." }, { status: 413 });
    const body = JSON.parse(raw) as { analysis?: RepositoryAnalysis; kind?: unknown; enhanceWithAi?: unknown };
    if (!body.analysis?.repository?.commit || typeof body.kind !== "string" || !kinds.has(body.kind as DocumentationKind)) {
      return Response.json({ error: "Provide an analyzed repository and a supported documentation type." }, { status: 400 });
    }
    const kind = body.kind as DocumentationKind;
    let markdown = generateDocumentation(body.analysis, kind);
    let mode: "evidence" | "ai" = "evidence";
    if (body.enhanceWithAi === true) {
      const provider = getAiProvider();
      if (!provider) return Response.json({ error: "AI enhancement was requested, but no server-side AI provider is configured." }, { status: 503 });
      markdown = await completeWithAi(provider,
        "You generate documentation from repository evidence. Do not invent APIs, behavior, dependencies, or environment values. Preserve the supplied headings when possible, label uncertainty, and include exact file paths from the evidence.",
        `Documentation type: ${kind}\n\nEvidence-based draft:\n${markdown}`, 1_800);
      mode = "ai";
    }
    return Response.json({ markdown, mode });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Documentation generation failed." }, { status });
  }
}
