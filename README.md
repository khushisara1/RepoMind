# RepoMind

RepoMind turns a **public GitHub repository** into a commit-pinned workspace for exploring files, source imports, setup commands, recent Git history, source-grounded chat, documentation drafts, read-only pull-request reviews, and repository comparisons. It supports nested package manifests in monorepos. The scan is read-only and never executes repository code.

## Current implementation

The app is organized in five steps:

1. **Foundation:** public GitHub URL validation, metadata and tree scan, language mix, file explorer, and repository overview.
2. **Code intelligence:** bounded source sampling, symbol and import extraction, dependency manifests, TODO/FIXME markers, and file citations.
3. **Visual exploration:** interactive import map, static module-flow view, and dependency impact counts.
4. **Getting started:** per-manifest install, run, and test commands, project signals, TODO notes, and commit history.
5. **AI platform:** source-grounded chat, editable evidence-based documentation drafts, optional server-side AI enhancement, read-only pull-request analysis, and bounded repository comparison.
6. **Reliability:** request and file limits, fixed GitHub hosts, retry and error states, dark/light themes, responsive navigation, unit checks, and production build support.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Paste a public GitHub URL. The Express repository is available as an example.

Use these checks before shipping:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | No | Optional GitHub token for a higher API rate limit. Keep it server-side. |
| `AI_API_KEY` | No | API key for an OpenAI-compatible chat completions endpoint. Enables synthesized explanations. |
| `AI_BASE_URL` | No | Provider base URL. Defaults to `https://api.groq.com/openai/v1`. |
| `AI_MODEL` | No | Model name. Defaults to `llama-3.3-70b-versatile`. |
| `GROQ_API_KEY` | No | Groq shortcut when `AI_API_KEY` is not set. |

Without an AI key, repository chat searches actual source and returns matching excerpts with exact line references. “Explain this file” stays pinned to that one file: without AI it returns a structural summary, and with AI it receives only that file’s source. AI keys never go to the browser. Keep the provider URL and credentials in server environment settings.

## Database configuration

`supabase/schema.sql` defines the planned Supabase tables for repositories, files, code chunks with pgvector embeddings, analysis snapshots, conversations, messages, learning progress, dependencies, and commits. It enables row-level security and owner-scoped policies. The current app does **not** connect to Supabase; it keeps the active snapshot in browser session storage and learning progress in local storage. Do not add a service-role key to client code.

## Deploy

Deploy as a Node.js Next.js application. Configure the environment variables above in the hosting provider. A `GITHUB_TOKEN` is recommended for repeated use. The analysis routes make bounded GitHub requests during a single request, so choose a host with sufficient function duration for the size of repositories you support. The app does not need a Redis worker for the current bounded scan.

For Supabase, apply `supabase/schema.sql` in a new project, configure the project’s Auth and database policies, then add a server-only data layer before enabling persistence. No Supabase URL or key is read by this version.

## API routes

- `POST /api/analyze` — validates a repository URL and returns metadata, the pinned commit, ranked file tree, language counts, sampled imports, symbols, manifests, and contribution markers.
- `GET /api/file?repo=…&sha=…&path=…` — reads one text file at a commit, with a 128 KB response limit.
- `POST /api/chat` — retrieves source for a repository question or accepts an optional `filePath` to explain that exact file. Citation links come from server-fetched source.
- `POST /api/documentation` — generates editable Markdown documentation from the analyzed snapshot, with optional server-side AI enhancement.
- `POST /api/pull-request` — reads a public pull request and changed-file patches, returning a read-only review report. It never approves, merges, or publishes comments.
- `POST /api/compare` — analyzes two public repositories with the same bounded engine and returns evidence-based technology, structure, dependency, documentation, and testing indicators.
- `GET /api/history?repo=…` — reads up to 12 recent commits and details for up to six.
- `GET /api/health` — reports whether optional server-side credentials are configured without returning secrets.

## Security and scope

- Only `https://github.com/{owner}/{repository}` URLs are accepted. Outbound repository fetches use fixed GitHub API and raw-content hosts.
- Repositories larger than 100 MB or trees above 40,000 files are rejected. A truncated GitHub tree is rejected.
- The explorer shows at most 4,000 ranked paths. The analyzer samples up to 36 files across repository areas, prioritizes nested dependency manifests and entry points, reads each file up to 48 KB, and caps the sample at 650 KB. Other supported text files load on demand. File preview is capped at 128 KB.
- GitHub request rates are limited per process. For multi-instance production deployments, add a shared rate limiter.
- Repository files are treated as untrusted text and are never executed.

## Known limitations

- Source parsing uses bounded lexical patterns, not Tree-sitter. Symbol and import extraction can miss language syntax, aliases, generated module resolution, dynamic imports, and call relationships.
- The architecture and flow views show verified local imports from the sampled files. They do not establish runtime order, function calls, API/database behavior, or external service wiring.
- Repository chat retrieval is currently keyword/path-based over a small source sample. File explanations use only the requested file. Embeddings, pgvector retrieval, conversation persistence, streaming, and full semantic chunking are not connected yet.
- Documentation drafts and pull-request fallback reviews are deterministic evidence summaries when no AI key is configured; optional AI output is constrained to supplied repository evidence and is not a substitute for human review.
- Pull-request analysis currently supports public repositories and patch-based review only. GitHub OAuth, private repository access, publishing comments, and background indexing are not connected.
- Repository comparison reports detected signals rather than a universal quality score. It does not claim that one repository is inherently better.
- The optional LLM explains only retrieved excerpts. The app displays citations assembled from those exact files and lines; it removes citations written by the model itself.
- Contribution suggestions are repository signals, not GitHub issue triage. Private repository OAuth, team accounts, background jobs, and a persistent analysis database are not included.
- Monorepo manifest detection and import extraction are bounded lexical checks. Build-specific aliases and generated paths can still be missed when project configuration is unusual.
