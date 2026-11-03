import { completeWithAi, getAiProvider } from "@/lib/ai";
import { githubJson, parseRepoUrl } from "@/lib/github";
import { allowRequest, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

type PullRequest = { number: number; title: string; body: string | null; html_url: string; user?: { login?: string }; base: { ref: string; sha: string }; head: { ref: string; sha: string }; changed_files: number; additions: number; deletions: number; mergeable?: boolean | null };
type PullFile = { filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string };

function deterministicFindings(files: PullFile[]) {
  return files.flatMap((file) => {
    const findings: { severity: "medium" | "low"; file: string; line: number | null; explanation: string; impact: string; fix: string; confidence: number }[] = [];
    const patch = file.patch || "";
    if (/\b(eval|exec)\s*\(/.test(patch)) findings.push({ severity: "medium", file: file.filename, line: null, explanation: "The patch introduces dynamic code execution.", impact: "Untrusted input could become executable if it reaches this path.", fix: "Prefer a safe parser or allowlist and validate inputs before evaluation.", confidence: 7 });
    if (/\b(TODO|FIXME)\b/i.test(patch)) findings.push({ severity: "low", file: file.filename, line: null, explanation: "The patch adds an unresolved TODO or FIXME marker.", impact: "The change may be incomplete or leave follow-up work undocumented.", fix: "Resolve the marker or link it to a tracked issue.", confidence: 8 });
    return findings;
  });
}

export async function POST(request: Request) {
  if (!allowRequest(request, "pull-request", 8)) return rateLimitResponse();
  try {
    const raw = await request.text();
    if (raw.length > 4_000) return Response.json({ error: "Pull request request is too large." }, { status: 413 });
    const body = JSON.parse(raw) as { repositoryUrl?: unknown; number?: unknown; enhanceWithAi?: unknown };
    const repo = parseRepoUrl(body.repositoryUrl);
    const number = typeof body.number === "number" && Number.isInteger(body.number) ? body.number : Number(body.number);
    if (!repo || !Number.isSafeInteger(number) || number < 1 || number > 1_000_000) return Response.json({ error: "Provide a valid repository URL and pull request number." }, { status: 400 });
    const base = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
    const pull = await githubJson<PullRequest>(`${base}/pulls/${number}`, 500_000);
    const filesResponse = await githubJson<PullFile[]>(`${base}/pulls/${number}/files?per_page=100`, 6_000_000);
    const files = filesResponse.slice(0, 100).map((file) => ({ ...file, patch: file.patch?.slice(0, 16_000) }));
    let findings = deterministicFindings(files);
    let summary = `PR #${pull.number} changes ${pull.changed_files} files (+${pull.additions}/-${pull.deletions}) from ${pull.head.ref} into ${pull.base.ref}.`;
    let mode: "evidence" | "ai" = "evidence";
    if (body.enhanceWithAi === true) {
      const provider = getAiProvider();
      if (!provider) return Response.json({ error: "AI enhancement was requested, but no server-side AI provider is configured." }, { status: 503 });
      const answer = await completeWithAi(provider,
        "Review only the supplied GitHub pull request metadata and patches. Return JSON with keys summary and findings. Each finding must have severity, file, line, explanation, impact, fix, confidence. Do not invent line numbers; use null when the patch does not expose one. Never suggest merging or approving.",
        JSON.stringify({ pull, files }), 2_000);
      try {
        const parsed = JSON.parse(answer) as { summary?: string; findings?: typeof findings };
        if (typeof parsed.summary === "string") summary = parsed.summary;
        if (Array.isArray(parsed.findings)) findings = parsed.findings.slice(0, 30);
      } catch {
        summary = answer;
      }
      mode = "ai";
    }
    return Response.json({ pull, files, findings, summary, mode, readOnly: true });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 502;
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Pull request analysis failed." }, { status });
  }
}
