import { githubJson, parseRepoUrl } from "@/lib/github";
import { allowRequest, rateLimitResponse } from "@/lib/rate-limit";
import type { RepoCommit } from "@/lib/types";

export const runtime = "nodejs";

type GitHubCommitRow = { sha: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string } | null };
type GitHubCommitDetail = GitHubCommitRow & { files?: { filename: string }[] };

export async function GET(request: Request) {
  if (!allowRequest(request, "history", 10)) return rateLimitResponse();
  const query = new URL(request.url).searchParams;
  const repo = parseRepoUrl(query.get("repo"));
  if (!repo) return Response.json({ error: "Invalid repository URL." }, { status: 400 });
  try {
    const base = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
    const rows = await githubJson<GitHubCommitRow[]>(`${base}/commits?per_page=12`, 500_000);
    const details = await Promise.all(rows.slice(0, 6).map(async (row) => {
      try { return await githubJson<GitHubCommitDetail>(`${base}/commits/${row.sha}`, 800_000); }
      catch { return row as GitHubCommitDetail; }
    }));
    const commits: RepoCommit[] = details.map((row) => ({
      sha: row.sha, shortSha: row.sha.slice(0, 7), message: row.commit.message.split("\n")[0].slice(0, 180),
      author: row.author?.login || row.commit.author?.name || "Unknown contributor", date: row.commit.author?.date || "",
      files: (row.files || []).map((file) => file.filename).slice(0, 20),
    }));
    const touched = new Map<string, number>();
    for (const commit of commits) for (const path of commit.files) touched.set(path, (touched.get(path) || 0) + 1);
    const frequentFiles = [...touched].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, changes]) => ({ path, changes }));
    return Response.json({ commits, frequentFiles, sampledCommits: details.length });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 502;
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 250) : "Could not load commit history." }, { status });
  }
}
