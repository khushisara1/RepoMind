export type GitHubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  size: number;
  license: { spdx_id?: string; name?: string } | null;
  git_url?: string;
};

export type TreeEntry = { path: string; type: "blob" | "tree"; size?: number; sha: string; mode: string };
export type ParsedRepo = { owner: string; name: string; fullName: string; url: string };

const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO = /^[A-Za-z0-9_.-]{1,100}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const EXCLUDED_DIR = /(^|\/)(?:\.git|node_modules|\.next|\.venv|venv|build|dist|coverage|vendor|target|out|\.turbo|\.cache)(\/|$)/i;
const TEXT_EXTENSIONS = new Set([
  "py", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "java", "c", "h", "cc", "cpp", "hpp", "go", "html", "htm", "css", "scss", "php", "rb", "md", "mdx", "json", "json5", "yaml", "yml", "toml", "xml", "sql", "sh", "env", "txt", "rst", "vue", "svelte", "graphql", "gql", "prisma", "dockerfile", "makefile", "lock", "gitignore", "example", "properties", "ini", "conf", "cfg", "gradle", "rake", "patch"
]);

export function parseRepoUrl(input: unknown): ParsedRepo | null {
  if (typeof input !== "string" || input.length > 500) return null;
  try {
    const url = new URL(input.trim().replace(/\.git\/?$/i, ""));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.port || url.search || url.hash) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || !GITHUB_OWNER.test(parts[0]) || !GITHUB_REPO.test(parts[1]) || parts[1] === "." || parts[1] === "..") return null;
    const owner = parts[0];
    const name = parts[1].replace(/\.git$/i, "");
    return { owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` };
  } catch {
    return null;
  }
}

export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && COMMIT_SHA.test(value);
}

export function isSafeTextPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 400 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  if (EXCLUDED_DIR.test(value)) return false;
  const base = parts.at(-1)!.toLowerCase();
  const extension = base.includes(".") ? base.split(".").at(-1)! : base;
  return TEXT_EXTENSIONS.has(extension) || ["readme", "license", "dockerfile", "makefile", "gemfile", "procfile"].includes(base);
}

export function isExcludedPath(path: string): boolean {
  return EXCLUDED_DIR.test(path) || /(^|\/)(?:\.DS_Store|Thumbs\.db)$/i.test(path);
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "RepoMind-Repository-Analyzer/1.0",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new Error("GitHub response exceeded the configured size limit.");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("GitHub response exceeded the configured size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export async function githubJson<T>(url: string, limit = 8_000_000): Promise<T> {
  const response = await fetch(url, { headers: githubHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const message = response.status === 404 ? "Repository or branch not found. Check that it is public." : response.status === 403 || response.status === 429 ? "GitHub API rate limit reached. Add a GITHUB_TOKEN and try again." : `GitHub returned ${response.status}.`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  const bytes = await readLimited(response, limit);
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
  catch { throw new Error("GitHub returned an unreadable response."); }
}

export async function getRepoAndTree(repo: ParsedRepo) {
  const base = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const metadata = await githubJson<GitHubRepo>(base, 100_000);
  if (metadata.size > 100_000) throw Object.assign(new Error("This repository is over the 100 MB analysis limit."), { status: 413 });
  const branch = encodeURIComponent(metadata.default_branch);
  const commit = await githubJson<{ sha: string }>(`${base}/commits/${branch}`, 300_000);
  if (!isCommitSha(commit.sha)) throw new Error("GitHub returned an invalid commit identifier.");
  const tree = await githubJson<{ tree: TreeEntry[]; truncated?: boolean }>(`${base}/git/trees/${commit.sha}?recursive=1`, 8_000_000);
  return { metadata, commit: commit.sha, tree, base };
}

export async function fetchRawFile(repo: ParsedRepo, sha: string, path: string, maxBytes = 128_000): Promise<string> {
  if (!isCommitSha(sha) || !isSafeTextPath(path)) throw new Error("Invalid source reference.");
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${sha}/${safePath}`;
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  if (!response) {
    throw Object.assign(new Error("GitHub's file service could not be reached after 3 attempts. Check the connection and retry."), { status: 502, cause: lastError });
  }
  if (!response.ok) {
    const message = response.status === 404 ? "File not found at this commit." : [429, 500, 502, 503, 504].includes(response.status) ? "GitHub's file service is temporarily unavailable. Retry in a moment." : `GitHub file request failed (${response.status}).`;
    throw Object.assign(new Error(message), { status: response.status === 429 ? 503 : response.status });
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw Object.assign(new Error("File is larger than the 128 KB viewer limit."), { status: 413 });
  const bytes = await readLimited(response, maxBytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("\u0000")) throw Object.assign(new Error("This file appears to be binary and cannot be previewed."), { status: 415 });
  return text;
}

export function sourceLanguage(path: string): string {
  const ext = path.split(".").at(-1)?.toLowerCase() || path.toLowerCase();
  const map: Record<string, string> = { ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", py: "Python", java: "Java", c: "C", h: "C", cc: "C++", cpp: "C++", hpp: "C++", go: "Go", html: "HTML", htm: "HTML", css: "CSS", scss: "CSS", php: "PHP", rb: "Ruby", md: "Markdown", mdx: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", sql: "SQL" };
  return map[ext] || "Other";
}

export function extensionOf(path: string): string {
  const base = path.split("/").at(-1)?.toLowerCase() || path.toLowerCase();
  return base.includes(".") ? base.split(".").at(-1)! : base;
}

export function rankSourcePath(path: string): number {
  const p = path.toLowerCase();
  let score = 0;
  if (/(^|\/)(readme(?:\.[^/]*)?|package\.json|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|pom\.xml|composer\.json|gemfile|gemfile\.lock)$/i.test(p)) score += 100;
  if (/(^|\/)(dockerfile|makefile|\.gitignore|\.env(?:\.[^/]*)?|tsconfig\.json|next\.config\.(?:js|mjs|ts)|vite\.config\.(?:js|mjs|ts))$/i.test(p)) score += 65;
  if (/(^|\/)(src|app|pages|lib|server|api)\//i.test(path)) score += 25;
  if (/(^|\/)(index|main|app|server|cli|manage)\.(ts|tsx|js|jsx|py|java|go|c|cpp|php|rb)$/i.test(p)) score += 40;
  if (/(^|\/)(test|tests|__tests__|spec)\//i.test(p)) score -= 20;
  if (p.split("/").length === 1) score += 8;
  return score;
}

