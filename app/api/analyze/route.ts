import { analyzeRepository } from "@/lib/analysis";
import { parseRepoUrl } from "@/lib/github";
import { allowRequest, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!allowRequest(request, "analyze", 5)) return rateLimitResponse();
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 2_000) return Response.json({ error: "Request is too large." }, { status: 413 });
    const raw = await request.text();
    if (raw.length > 2_000) return Response.json({ error: "Request is too large." }, { status: 413 });
    const body = JSON.parse(raw) as { repositoryUrl?: unknown };
    const repo = parseRepoUrl(body.repositoryUrl);
    if (!repo) return Response.json({ error: "Enter a public GitHub URL in the form https://github.com/owner/repository." }, { status: 400 });
    const { analysis } = await analyzeRepository(repo);
    return Response.json({ analysis });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    const message = error instanceof Error ? error.message : "Repository analysis failed.";
    return Response.json({ error: message.slice(0, 300) }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
