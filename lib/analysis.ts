import { extensionOf, fetchRawFile, getRepoAndTree, rankSourcePath, sourceLanguage, type ParsedRepo, type TreeEntry } from "@/lib/github";
import type { RepoDependency, RepoEdge, RepoFile, RepoFinding, RepoManifest, RepositoryAnalysis, SourceFile } from "@/lib/types";

const SOURCE_EXTENSIONS = new Set(["py", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "java", "c", "h", "cc", "cpp", "hpp", "go", "html", "htm", "css", "php", "rb"]);
const SOURCE_BYTES_LIMIT = 650_000;
const FILE_SCAN_LIMIT = 36;
const DEPENDENCY_MANIFESTS = new Set(["package.json", "requirements.txt", "pyproject.toml", "go.mod", "cargo.toml", "pom.xml", "composer.json", "gemfile"]);

function classify(path: string, language: string): RepoFile["kind"] {
  const p = path.toLowerCase();
  const base = p.split("/").at(-1) || p;
  if (/(^|\/)(test|tests|__tests__|spec|specs)(\/|$)/.test(p) || /\.(test|spec)\./.test(base)) return "test";
  if (/^(readme|contributing|changelog|license|code_of_conduct|security)(\.|$)/.test(base) || ["md", "mdx", "rst"].includes(extensionOf(path))) return "documentation";
  if (["json", "yaml", "yml", "toml", "xml", "env", "dockerfile", "makefile", "gitignore", "example", "lock"].includes(extensionOf(path)) || isDependencyManifest(path) || base.startsWith(".env") || /^(package\.json|tsconfig|vite\.config|next\.config|pyproject|cargo\.toml|go\.mod|pom\.xml|composer\.json|gemfile)/.test(base)) return "config";
  if (language !== "Other") return "source";
  return "other";
}

function isDependencyManifest(path: string): boolean {
  return DEPENDENCY_MANIFESTS.has(path.split("/").at(-1)!.toLowerCase());
}

function scanArea(path: string): string {
  const directories = path.split("/").slice(0, -1);
  return directories.length ? directories.slice(0, 2).join("/").toLowerCase() : "(root)";
}

function spreadAcrossAreas(entries: TreeEntry[], limit: number): TreeEntry[] {
  const groups = new Map<string, TreeEntry[]>();
  for (const entry of entries) {
    const area = scanArea(entry.path);
    const group = groups.get(area) || [];
    group.push(entry);
    groups.set(area, group);
  }
  for (const group of groups.values()) group.sort((a, b) => rankSourcePath(b.path) - rankSourcePath(a.path) || a.path.localeCompare(b.path));
  const orderedAreas = [...groups.keys()].sort((a, b) => rankSourcePath(groups.get(b)![0].path) - rankSourcePath(groups.get(a)![0].path) || a.localeCompare(b));
  const selected: TreeEntry[] = [];
  for (let round = 0; selected.length < limit; round++) {
    let added = false;
    for (const area of orderedAreas) {
      const entry = groups.get(area)?.[round];
      if (entry) { selected.push(entry); added = true; if (selected.length >= limit) break; }
    }
    if (!added) break;
  }
  return selected;
}

function selectScanCandidates(blobs: TreeEntry[]): TreeEntry[] {
  const candidates = blobs.filter((entry) => {
    const base = entry.path.split("/").at(-1)?.toLowerCase() || "";
    const usefulText = SOURCE_EXTENSIONS.has(extensionOf(entry.path)) || isDependencyManifest(entry.path)
      || /^readme(?:\.|$)/i.test(base) || ["dockerfile", "makefile", ".gitignore"].includes(base) || base.startsWith(".env.");
    return usefulText && (entry.size || 0) <= 48_000;
  });
  const selected = new Map<string, TreeEntry>();
  const take = (entries: TreeEntry[], limit: number) => {
    for (const entry of spreadAcrossAreas(entries.filter((item) => !selected.has(item.path)), limit)) selected.set(entry.path, entry);
  };
  take(candidates.filter((entry) => isDependencyManifest(entry.path)), 10);
  take(candidates.filter((entry) => /^readme(?:\.|$)/i.test(entry.path.split("/").at(-1) || "")).sort((a, b) => rankSourcePath(b.path) - rankSourcePath(a.path)), 2);
  const sourceFiles = candidates.filter((entry) => SOURCE_EXTENSIONS.has(extensionOf(entry.path)));
  take(sourceFiles.filter((entry) => /(^|\/)(index|main|app|server|cli|manage)\.(ts|tsx|js|jsx|py|java|go|c|cpp|php|rb)$/i.test(entry.path)), 8);
  take(sourceFiles, FILE_SCAN_LIMIT - selected.size);
  take(candidates.sort((a, b) => rankSourcePath(b.path) - rankSourcePath(a.path) || a.path.localeCompare(b.path)), FILE_SCAN_LIMIT - selected.size);
  return [...selected.values()].slice(0, FILE_SCAN_LIMIT);
}

function importReferences(path: string, text: string): { specifier: string; line: number }[] {
  const refs: { specifier: string; line: number }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const patterns = [
      /\bfrom\s+["']([^"']+)["']/g,
      /\bimport\s+["']([^"']+)["']/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
      /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g,
      /^\s*import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g,
    ];
    const seen = new Set<string>();
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const specifier = match[1] || match[2];
        if (specifier && !seen.has(specifier)) { refs.push({ specifier, line: index + 1 }); seen.add(specifier); }
      }
    }
  });
  return refs;
}

function extractSymbols(text: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:def|class)\s+([A-Za-z_][\w]*)\s*\(/g,
    /\b(?:public|private|protected|static|async|final|void|int|String|boolean|func|fn)\s+([A-Za-z_][\w]*)\s*\(/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null && symbols.size < 40) symbols.add(match[1]);
  }
  return [...symbols];
}

export function resolveLocalImport(fromPath: string, specifier: string, known: Set<string>): string | null {
  const bases: string[] = [];
  if (specifier.startsWith(".")) {
    const parts = fromPath.split("/");
    parts.pop();
    for (const piece of specifier.split("/")) {
      if (!piece || piece === ".") continue;
      if (piece === "..") parts.pop(); else parts.push(piece);
    }
    bases.push(parts.join("/"));
  } else if (specifier.startsWith("@/")) {
    const alias = specifier.slice(2);
    const directories = fromPath.split("/").slice(0, -1);
    const srcIndex = directories.lastIndexOf("src");
    const projectRoot = directories.slice(0, srcIndex > 0 ? srcIndex : Math.min(1, directories.length)).join("/");
    bases.push(`${projectRoot ? `${projectRoot}/` : ""}src/${alias}`, `${projectRoot ? `${projectRoot}/` : ""}${alias}`, alias);
  } else {
    return null;
  }
  const extensions = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "java", "go", "c", "cpp", "php", "rb", "css", "scss", "json", "vue", "svelte"];
  const candidates = [...new Set(bases.flatMap((base) => [base, ...extensions.map((ext) => `${base}.${ext}`), ...["index.ts", "index.tsx", "index.js", "index.jsx", "index.css", "__init__.py"].map((name) => `${base}/${name}`)]))];
  return candidates.find((candidate) => known.has(candidate)) || null;
}

function importance(path: string, kind: RepoFile["kind"], entryPoints: string[]): RepoFile["importance"] {
  if (kind === "test") return "test";
  if (kind === "config") return "configuration";
  if (entryPoints.includes(path)) return "critical";
  if (/(^|\/)(auth|api|server|database|db|routes?|services?|main|index)(\/|\.)/i.test(path)) return "important";
  return "supporting";
}

function descriptionFromReadme(readme?: string): string | null {
  if (!readme) return null;
  const lines = readme.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#") || /^[-=*`>]/.test(line) || /^https?:/.test(line)) continue;
    return line.replace(/[`*_]/g, "").slice(0, 280);
  }
  return null;
}

function getFrameworks(dependencies: RepoDependency[], files: TreeEntry[], snippets: Map<string, string>): string[] {
  const names = new Set(dependencies.map((d) => d.name.toLowerCase()));
  const paths = new Set(files.map((f) => f.path.toLowerCase()));
  const frameworks: string[] = [];
  const evidence: [string, string, boolean][] = [
    ["Next.js", "next", names.has("next") || paths.has("next.config.js") || paths.has("next.config.ts")],
    ["React", "react", names.has("react")],
    ["Vue", "vue", names.has("vue") || [...snippets.values()].some((s) => s.includes("createApp("))],
    ["Angular", "angular", [...names].some((name) => name.startsWith("@angular/"))],
    ["Express", "express", names.has("express")],
    ["FastAPI", "fastapi", names.has("fastapi") || [...snippets.values()].some((s) => s.includes("FastAPI("))],
    ["Django", "django", names.has("django") || paths.has("manage.py")],
    ["Flask", "flask", names.has("flask")],
    ["Spring", "spring", [...names].some((name) => name.includes("spring-boot"))],
    ["Laravel", "laravel", names.has("laravel/framework")],
    ["Rails", "rails", names.has("rails")],
    ["Gin", "gin", names.has("github.com/gin-gonic/gin")],
  ];
  for (const [label, , found] of evidence) if (found) frameworks.push(label);
  return frameworks;
}

async function limitedMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await fn(items[index]);
    }
  }));
  return result;
}

function siblingPath(path: string, name: string): string {
  const directory = path.split("/").slice(0, -1).join("/");
  return directory ? `${directory}/${name}` : name;
}

export function parseManifestFiles(paths: string[], snippets: Map<string, string>) {
  const dependencies: RepoDependency[] = [];
  const scripts: { name: string; command: string; manifestPath: string }[] = [];
  const manifestPaths = paths.filter(isDependencyManifest).sort((a, b) => rankSourcePath(b) - rankSourcePath(a) || a.localeCompare(b));
  const manifests: RepoManifest[] = manifestPaths.map((path) => {
    const base = path.split("/").at(-1)!.toLowerCase();
    const text = snippets.get(path);
    const directory = path.split("/").slice(0, -1).join("/") || ".";
    const localDependencies: RepoDependency[] = [];
    const localScripts: { name: string; command: string }[] = [];
    const addDependency = (name: string, version: string, group: RepoDependency["group"] = "runtime") => {
      if (name && !localDependencies.some((dependency) => dependency.name === name && dependency.group === group)) {
        const dependency = { name, version, group, manifestPath: path };
        localDependencies.push(dependency);
        dependencies.push(dependency);
      }
    };
    let ecosystem = "Unknown";
    if (base === "package.json") {
      ecosystem = "Node.js";
      if (text) try {
        const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
        for (const [name, version] of Object.entries(pkg.dependencies || {})) addDependency(name, version, "runtime");
        for (const [name, version] of Object.entries(pkg.devDependencies || {})) addDependency(name, version, "development");
        for (const [name, command] of Object.entries(pkg.scripts || {}).slice(0, 24)) localScripts.push({ name, command: String(command).slice(0, 180) });
      } catch { /* Invalid JSON does not stop the rest of the repository scan. */ }
    } else if (base === "requirements.txt") {
      ecosystem = "Python";
      if (text) for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
        const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?:([=<>~!]+)\s*([^;#\s]+))?/);
        if (match) addDependency(match[1], match[2] ? `${match[2]}${match[3] || ""}` : "unbounded");
      }
    } else if (base === "pyproject.toml") {
      ecosystem = "Python";
      if (text) {
        let group: RepoDependency["group"] = "runtime";
        for (const line of text.split(/\r?\n/)) {
          if (/^\s*\[(?:tool\.)?poetry\.group\.[^\]]+\.dependencies\]/i.test(line) || /^\s*\[project\.optional-dependencies\./i.test(line)) group = "development";
          else if (/^\s*\[(?:project|tool\.poetry\.dependencies)\]/i.test(line)) group = "runtime";
          const inlineDependencies = line.match(/^\s*dependencies\s*=\s*\[(.*)\]/i)?.[1];
          if (inlineDependencies) for (const [, requirement] of inlineDependencies.matchAll(/["']([^"']+)["']/g)) {
            const parsed = requirement.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*([<>=!~].*)?$/);
            if (parsed) addDependency(parsed[1], parsed[2]?.trim() || "declared", group);
          }
          const match = line.match(/^\s*["']?([A-Za-z0-9_.-]+)["']?\s*=\s*(?:["']([^"']+)["']|.*?version\s*=\s*["']([^"']+)["'])/i);
          if (match && !["python", "name", "version", "description"].includes(match[1].toLowerCase())) addDependency(match[1], match[2] || match[3] || "declared", group);
        }
      }
    } else if (base === "go.mod") {
      ecosystem = "Go";
      if (text) for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z0-9._~/-]+)\s+(v\d[^\s]*)/);
        if (match && !["module", "go", "toolchain"].includes(match[1])) addDependency(match[1], match[2]);
      }
    } else if (base === "cargo.toml") {
      ecosystem = "Rust";
      if (text) {
        let group: RepoDependency["group"] = "runtime";
        for (const line of text.split(/\r?\n/)) {
          if (/^\s*\[(?:dev-dependencies|workspace\.dev-dependencies)\]/i.test(line)) group = "development";
          else if (/^\s*\[(?:dependencies|workspace\.dependencies)\]/i.test(line)) group = "runtime";
          const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:["']([^"']+)["']|.*?version\s*=\s*["']([^"']+)["'])/);
          if (match) addDependency(match[1], match[2] || match[3] || "declared", group);
        }
      }
    } else if (base === "composer.json") {
      ecosystem = "PHP";
      if (text) try {
        const manifest = JSON.parse(text) as { require?: Record<string, string>; "require-dev"?: Record<string, string> };
        for (const [name, version] of Object.entries(manifest.require || {})) if (name !== "php") addDependency(name, version, "runtime");
        for (const [name, version] of Object.entries(manifest["require-dev"] || {})) addDependency(name, version, "development");
      } catch { /* Invalid JSON does not stop the rest of the repository scan. */ }
    } else if (base === "pom.xml") {
      ecosystem = "Java";
      if (text) for (const block of text.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi)) {
        const dependency = block[1];
        const groupId = dependency.match(/<groupId>\s*([^<]+)\s*<\/groupId>/i)?.[1];
        const artifactId = dependency.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/i)?.[1];
        const version = dependency.match(/<version>\s*([^<]+)\s*<\/version>/i)?.[1] || "managed";
        if (groupId && artifactId) addDependency(`${groupId}:${artifactId}`, version);
      }
    } else if (base === "gemfile") {
      ecosystem = "Ruby";
      if (text) for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/);
        if (match) addDependency(match[1], match[2] || "unbounded");
      }
    }
    const script = localScripts.find((item) => item.name === "dev") || localScripts.find((item) => item.name === "start");
    const hasSibling = (name: string) => paths.includes(siblingPath(path, name));
    const packageManager = hasSibling("pnpm-lock.yaml") ? "pnpm" : hasSibling("yarn.lock") ? "yarn" : hasSibling("bun.lockb") || hasSibling("bun.lock") ? "bun" : "npm";
    const installCommand = ecosystem === "Node.js" ? packageManager === "pnpm" ? "pnpm install --frozen-lockfile" : packageManager === "yarn" ? "yarn install --frozen-lockfile" : packageManager === "bun" ? "bun install --frozen-lockfile" : hasSibling("package-lock.json") ? "npm ci" : "npm install"
      : base === "requirements.txt" ? `python -m pip install -r ${path}`
      : base === "pyproject.toml" ? hasSibling("uv.lock") ? `uv sync --directory ${directory}` : hasSibling("poetry.lock") ? directory === "." ? "poetry install" : `poetry -C ${directory} install` : `python -m pip install ${directory}`
      : base === "go.mod" ? `go -C ${directory} mod download`
      : base === "cargo.toml" ? `cargo build --manifest-path ${path}`
      : base === "pom.xml" ? `mvn -f ${path} install`
      : base === "composer.json" ? `composer install --working-dir=${directory}`
      : base === "gemfile" ? `bundle install --gemfile=${path}` : null;
    const runCommand = ecosystem === "Node.js" && script ? `${packageManager} ${script.name === "start" ? "start" : `run ${script.name}`}`
      : base === "go.mod" && paths.includes(siblingPath(path, "main.go")) ? "go run ."
      : base === "cargo.toml" && paths.includes(siblingPath(path, "src/main.rs")) ? `cargo run --manifest-path ${path}` : null;
    const testScript = localScripts.find((item) => item.name === "test");
    const testCommand = testScript ? `${packageManager} test`
      : base === "go.mod" ? `go -C ${directory} test ./...`
      : base === "cargo.toml" ? `cargo test --manifest-path ${path}`
      : base === "pom.xml" ? `mvn -f ${path} test`
      : ["requirements.txt", "pyproject.toml"].includes(base) && localDependencies.some((dependency) => dependency.name.toLowerCase() === "pytest") ? `pytest ${directory === "." ? "" : directory}`.trim() : null;
    scripts.push(...localScripts.map((item) => ({ ...item, manifestPath: path })));
    return { path, ecosystem, workingDirectory: directory, scanned: snippets.has(path), dependencyCount: localDependencies.length, installCommand: snippets.has(path) ? installCommand : null, runCommand: snippets.has(path) ? runCommand : null, testCommand: snippets.has(path) ? testCommand : null, scripts: localScripts };
  });
  return { dependencies, scripts, manifests };
}

export async function analyzeRepository(repo: ParsedRepo): Promise<{ analysis: RepositoryAnalysis; files: RepoFile[] }> {
  const { metadata, commit, tree } = await getRepoAndTree(repo);
  if (tree.truncated) throw Object.assign(new Error("GitHub truncated this repository tree. Try a smaller repository."), { status: 413 });
  const blobs = tree.tree.filter((entry) => entry.type === "blob" && !/(^|\/)(?:\.git|node_modules|\.next|\.venv|venv|build|dist|coverage|vendor|target|out|\.turbo|\.cache)(\/|$)/i.test(entry.path));
  const totalFiles = blobs.length;
  if (totalFiles > 40_000) throw Object.assign(new Error("This repository contains more than 40,000 files and exceeds the index limit."), { status: 413 });
  const paths = blobs.map((entry) => entry.path);

  const bytesByLanguage = new Map<string, number>();
  for (const entry of blobs) {
    const lang = sourceLanguage(entry.path);
    if (lang !== "Other" && SOURCE_EXTENSIONS.has(extensionOf(entry.path))) bytesByLanguage.set(lang, (bytesByLanguage.get(lang) || 0) + (entry.size || 0));
  }
  const totalLanguageBytes = [...bytesByLanguage.values()].reduce((a, b) => a + b, 0) || 1;
  const languages = [...bytesByLanguage].sort((a, b) => b[1] - a[1]).map(([name, bytes]) => ({ name, bytes, percent: Math.round(bytes / totalLanguageBytes * 100) }));

  const candidates = selectScanCandidates(blobs);
  let reservedSampleBytes = 0;
  let totalSampleBytes = 0;
  const snippets = new Map<string, string>();
  await limitedMap(candidates, 4, async (entry) => {
    const size = entry.size || 0;
    if (reservedSampleBytes + size > SOURCE_BYTES_LIMIT) return null;
    reservedSampleBytes += size;
    try {
      const text = await fetchRawFile(repo, commit, entry.path, 48_000);
      snippets.set(entry.path, text);
      totalSampleBytes += new TextEncoder().encode(text).byteLength;
    } catch { reservedSampleBytes -= size; /* Keep an incomplete scan usable when an individual raw file is unavailable. */ }
    return null;
  });
  const knownPaths = new Set(blobs.map((entry) => entry.path));
  const entryPoints = blobs.filter((entry) => /(^|\/)(index|main|app|server|cli|manage)\.(ts|tsx|js|jsx|py|java|go|c|cpp|php|rb)$/i.test(entry.path)).map((entry) => entry.path).slice(0, 8);
  const files: RepoFile[] = blobs.sort((a, b) => rankSourcePath(b.path) - rankSourcePath(a.path)).slice(0, 4_000).map((entry) => {
    const language = sourceLanguage(entry.path);
    const kind = classify(entry.path, language);
    const content = snippets.get(entry.path);
    const imports = content ? importReferences(entry.path, content).map((ref) => ref.specifier) : [];
    return {
      path: entry.path,
      size: entry.size || 0,
      language,
      kind,
      importance: importance(entry.path, kind, entryPoints),
      imports: [...new Set(imports)].slice(0, 18),
      symbols: content ? extractSymbols(content) : [],
      scanned: Boolean(content),
    };
  });
  const edges: RepoEdge[] = [];
  for (const [path, content] of snippets) {
    for (const ref of importReferences(path, content)) {
      const target = resolveLocalImport(path, ref.specifier, knownPaths);
      if (target) edges.push({ from: path, to: target, line: ref.line, specifier: ref.specifier });
    }
  }
  const { dependencies, scripts: packageScripts, manifests: packageManifests } = parseManifestFiles(paths, snippets);
  const primaryManifest = packageManifests.find((manifest) => manifest.scanned) || packageManifests[0];
  const testFiles = paths.filter((path) => /(^|\/)(test|tests|__tests__|spec|specs)(\/|$)|\.(test|spec)\./i.test(path)).slice(0, 30);
  const directories = new Map<string, number>();
  for (const path of paths) {
    const first = path.split("/")[0];
    if (path.includes("/")) directories.set(first, (directories.get(first) || 0) + 1);
  }
  const readmePath = paths.find((path) => /^readme(?:\.|$)/i.test(path)) || null;
  const packagePath = primaryManifest?.path || null;
  const readme = readmePath ? snippets.get(readmePath) : undefined;
  const purpose = metadata.description?.trim() || descriptionFromReadme(readme) || "No repository description was found in GitHub metadata or the scanned README.";
  const directoryList = [...directories].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  const findings: RepoFinding[] = [];
  for (const [path, content] of snippets) content.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/\b(TODO|FIXME|HACK)\b:?\s*(.*)/i);
    if (match && findings.length < 100) findings.push({ path, line: index + 1, text: `${match[1].toUpperCase()}${match[2] ? `: ${match[2].trim()}` : ""}`.slice(0, 240), kind: match[1].toUpperCase() as RepoFinding["kind"] });
  });
  const installCommand = primaryManifest?.installCommand || null;
  const runCommand = primaryManifest?.runCommand || null;
  const testCommand = primaryManifest?.testCommand || null;
  const summary = {
    purpose,
    entryPoints,
    frameworks: getFrameworks(dependencies, blobs, snippets),
    directories: directoryList,
    readmePath,
    packagePath,
    packageScripts,
    packageManifests,
    installCommand,
    runCommand,
    testCommand,
    testFiles,
    hasLicense: paths.some((path) => /^license(?:\.|$)/i.test(path)),
  };
  const analysis: RepositoryAnalysis = {
    repository: {
      owner: metadata.full_name.split("/")[0], name: metadata.name, fullName: metadata.full_name, url: metadata.html_url,
      description: metadata.description || "", defaultBranch: metadata.default_branch, commit,
      stars: metadata.stargazers_count, forks: metadata.forks_count, sizeKb: metadata.size,
      license: metadata.license?.spdx_id || metadata.license?.name || null, analyzedAt: new Date().toISOString(),
    },
    files, scannedFiles: snippets.size, totalFiles, totalSampleBytes, truncated: blobs.length > files.length,
    languages, dependencies: dependencies.slice(0, 250), edges: edges.slice(0, 500), findings, summary,
  };
  return { analysis, files };
}

export async function getRepositoryTreeForQuery(repo: ParsedRepo, sha: string) {
  const base = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const tree = await (await import("@/lib/github")).githubJson<{ tree: TreeEntry[]; truncated?: boolean }>(`${base}/git/trees/${sha}?recursive=1`, 8_000_000);
  if (tree.truncated) throw new Error("Repository tree is too large for a complete retrieval.");
  return tree.tree.filter((entry) => entry.type === "blob" && !/(^|\/)(?:\.git|node_modules|\.next|\.venv|venv|build|dist|coverage|vendor|target|out)(\/|$)/i.test(entry.path));
}

export function retrieveEvidence(question: string, files: TreeEntry[]) {
  const terms = [...new Set((question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []))].filter((term) => !["the", "and", "how", "what", "where", "with", "from", "this", "that", "does", "which", "into", "could", "would", "explain", "repository", "file", "work"].includes(term));
  return files.filter((entry) => SOURCE_EXTENSIONS.has(extensionOf(entry.path)) && (entry.size || 0) <= 40_000)
    .map((entry) => {
      const path = entry.path.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (path.includes(term) ? 4 : 0), 0) + Math.min(rankSourcePath(entry.path), 30) / 10;
      return { entry, score };
    }).sort((a, b) => b.score - a.score).slice(0, 5).map(({ entry }) => entry);
}

export function matchedLineWindows(path: string, content: string, question: string): { start: number; end: number; text: string }[] {
  const terms = [...new Set((question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []))].filter((term) => !["the", "and", "how", "what", "where", "with", "from", "this", "that", "does", "which", "into", "could", "would", "explain", "repository", "file", "work"].includes(term));
  const lines = content.split(/\r?\n/);
  const scored = lines.map((line, index) => ({ line, index, score: terms.reduce((sum, term) => sum + (line.toLowerCase().includes(term) ? 1 : 0), 0) }));
  const hits = scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).map((hit) => hit.index);
  const anchors = hits.length ? hits : [0];
  const windows: { start: number; end: number; text: string }[] = [];
  for (const anchor of anchors) {
    const start = Math.max(0, anchor - 2);
    const end = Math.min(lines.length - 1, anchor + 3);
    if (windows.some((window) => start <= window.end + 1 && end >= window.start - 1)) continue;
    windows.push({ start: start + 1, end: end + 1, text: lines.slice(start, end + 1).join("\n").slice(0, 1300) });
  }
  return windows;
}

export function symbolsFor(path: string, content: string) {
  return { imports: importReferences(path, content), symbols: extractSymbols(content) };
}

export function explainFileStructure(path: string, content: string): string {
  const parsed = symbolsFor(path, content);
  const lines = content.split(/\r?\n/);
  const base = path.split("/").at(-1)?.toLowerCase() || path.toLowerCase();
  const language = sourceLanguage(path);
  let purpose = `${base} is a ${language} file.`;
  const steps: string[] = [];

  if (/reactdom\.createRoot\s*\(/i.test(content)) {
    purpose = "This is the browser entry point for a React application.";
    steps.push("It imports the React runtime, ReactDOM's browser rendering API, the root App component, and a stylesheet.");
    steps.push("It finds the page element named `root`, creates a React rendering root there, and renders the App component inside `React.StrictMode`.");
  } else if (/\bcreateRoot\s*\(/.test(content) && /\.render\s*\(/.test(content)) {
    purpose = "This file starts a React user interface in a browser page.";
    steps.push("It creates a rendering root from a page element and renders the component tree into that root.");
  } else if (/\bcreateApp\s*\(/.test(content) && /\.mount\s*\(/.test(content)) {
    purpose = "This file starts a Vue application.";
    steps.push("It creates the app instance and mounts it into a page element.");
  } else if (/\bFastAPI\s*\(/.test(content)) {
    purpose = "This file creates a FastAPI application.";
    steps.push("It defines the server object that FastAPI route decorators attach to.");
  } else if (/\bFlask\s*\(/.test(content)) {
    purpose = "This file creates a Flask web application.";
    steps.push("It defines the server object used by Flask routes and request handlers.");
  } else if (/\bexpress\s*\(/.test(content) && /\.listen\s*\(/.test(content)) {
    purpose = "This file creates and starts an Express web server.";
    steps.push("It configures the server and starts listening for requests.");
  } else if (/if\s+__name__\s*==\s*["']__main__["']/.test(content)) {
    purpose = "This Python file can be run directly as a script.";
    steps.push("Its `__main__` block runs when Python starts this file directly.");
  } else if (/(^|\/)(test|tests|__tests__|spec|specs)(\/|$)|\.(test|spec)\./i.test(path)) {
    purpose = `This is a ${language} test file.`;
    steps.push("It contains checks intended to verify application behavior.");
  } else if (isDependencyManifest(path)) {
    purpose = `This ${language} manifest declares project dependencies or scripts.`;
  }

  if (parsed.symbols.length) steps.push(`Declared functions, classes, or types include ${parsed.symbols.slice(0, 10).map((symbol) => `\`${symbol}\``).join(", ")}.`);
  if (parsed.imports.length && !/reactdom\.createRoot\s*\(/i.test(content)) {
    steps.push(`The file imports ${parsed.imports.slice(0, 8).map((item) => `\`${item.specifier}\``).join(", ")}.`);
  }
  if (!steps.length) {
    const notableLines = lines.map((line) => line.trim()).filter((line) => /^(?:export\s+|async\s+function|function\s+|class\s+|def\s+|@\w+\.|(?:const|let|var)\s+|return\b|if\s+__name__)/.test(line)).slice(0, 5);
    if (notableLines.length) steps.push(`The main visible statements are ${notableLines.map((line) => `\`${line.slice(0, 100)}\``).join("; ")}.`);
    else steps.push("The lightweight scanner could not identify a common entry point or named declaration in this file.");
  }

  return [`**${path}** ${purpose}`, ...steps.map((step) => `- ${step}`), "This explanation uses only the selected file."].join("\n\n");
}

export type { SourceFile };
