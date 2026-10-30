export type RepoFile = {
  path: string;
  size: number;
  language: string;
  kind: "source" | "config" | "documentation" | "test" | "other";
  importance: "critical" | "important" | "supporting" | "configuration" | "test";
  imports: string[];
  symbols: string[];
  scanned: boolean;
};

export type RepoDependency = { name: string; version: string; group: "runtime" | "development"; manifestPath?: string };
export type RepoManifest = {
  path: string;
  ecosystem: string;
  workingDirectory: string;
  scanned: boolean;
  dependencyCount: number;
  installCommand: string | null;
  runCommand: string | null;
  testCommand: string | null;
  scripts: { name: string; command: string }[];
};
export type RepoEdge = { from: string; to: string; line: number; specifier: string };
export type RepoFinding = { path: string; line: number; text: string; kind: "TODO" | "FIXME" | "HACK" };
export type RepoCommit = { sha: string; shortSha: string; message: string; author: string; date: string; files: string[] };

export type RepositoryAnalysis = {
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
    description: string;
    defaultBranch: string;
    commit: string;
    stars: number;
    forks: number;
    sizeKb: number;
    license: string | null;
    analyzedAt: string;
  };
  files: RepoFile[];
  scannedFiles: number;
  totalFiles: number;
  totalSampleBytes: number;
  truncated: boolean;
  languages: { name: string; bytes: number; percent: number }[];
  dependencies: RepoDependency[];
  edges: RepoEdge[];
  findings: RepoFinding[];
  summary: {
    purpose: string;
    entryPoints: string[];
    frameworks: string[];
    directories: { name: string; count: number }[];
    readmePath: string | null;
    packagePath: string | null;
    packageScripts: { name: string; command: string; manifestPath?: string }[];
    packageManifests: RepoManifest[];
    installCommand: string | null;
    runCommand: string | null;
    testCommand: string | null;
    testFiles: string[];
    hasLicense: boolean;
  };
};

export type SourceFile = {
  path: string;
  content: string;
  language: string;
  size: number;
  imports?: { specifier: string; line: number }[];
  symbols?: string[];
};
