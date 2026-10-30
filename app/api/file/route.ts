import { fetchRawFile, isCommitSha, isSafeTextPath, parseRepoUrl, sourceLanguage } from "@/lib/github";
import { allowRequest, rateLimitResponse } from "@/lib/rate-limit";
import { symbolsFor } from "@/lib/analysis";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!allowRequest(request, "file", 80)) return rateLimitResponse();
  const query = new URL(request.url).searchParams;
  const repo = parseRepoUrl(query.get("repo"));
  const sha = query.get("sha");
  const path = query.get("path");
  if (!repo || !isCommitSha(sha) || !isSafeTextPath(path)) return Response.json({ error: "Invalid repository, commit, or source path." }, { status: 400 });
  try {
    const content = await fetchRawFile(repo, sha, path, 128_000);
    const parsed = symbolsFor(path, content);
    return Response.json({ source: { path, content, language: sourceLanguage(path), size: new TextEncoder().encode(content).length, ...parsed } });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 502;
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 250) : "Could not load this source file." }, { status });
  }
}
