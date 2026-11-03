import { analyzeRepository } from "@/lib/analysis";
import { parseRepoUrl } from "@/lib/github";
import { allowRequest, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!allowRequest(request, "compare", 4)) return rateLimitResponse();
  try {
    const raw = await request.text();
    if (raw.length > 4_000) return Response.json({ error: "Comparison request is too large." }, { status: 413 });
    const body = JSON.parse(raw) as { firstUrl?: unknown; secondUrl?: unknown };
    const first = parseRepoUrl(body.firstUrl);
    const second = parseRepoUrl(body.secondUrl);
    if (!first || !second) return Response.json({ error: "Enter two public GitHub repository URLs." }, { status: 400 });
    if (first.fullName.toLowerCase() === second.fullName.toLowerCase()) return Response.json({ error: "Choose two different repositories." }, { status: 400 });
    const [left, right] = await Promise.all([analyzeRepository(first), analyzeRepository(second)]);
    const compare = (analysis: typeof left.analysis) => ({
      repository: analysis.repository,
      languages: analysis.languages.slice(0, 8),
      frameworks: analysis.summary.frameworks,
      dependencies: analysis.dependencies.slice(0, 80),
      files: analysis.totalFiles,
      sampledFiles: analysis.scannedFiles,
      importEdges: analysis.edges.length,
      testFiles: analysis.summary.testFiles.length,
      documentation: Boolean(analysis.summary.readmePath),
      setup: { install: analysis.summary.installCommand, run: analysis.summary.runCommand, test: analysis.summary.testCommand },
    });
    return Response.json({ first: compare(left.analysis), second: compare(right.analysis), readOnly: true });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 502;
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Repository comparison failed." }, { status });
  }
}
