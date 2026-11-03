import type { RepositoryAnalysis } from "@/lib/types";

export type DocumentationKind = "readme" | "architecture" | "api" | "database" | "setup" | "onboarding" | "module" | "environment";

const titles: Record<DocumentationKind, string> = {
  readme: "README",
  architecture: "Architecture",
  api: "API documentation",
  database: "Database schema",
  setup: "Installation and setup",
  onboarding: "Developer onboarding",
  module: "Module guide",
  environment: "Environment variables",
};

function bullets(values: string[], fallback: string) {
  return values.length ? values.map((value) => `- \`${value}\``).join("\n") : `- ${fallback}`;
}

export function generateDocumentation(analysis: RepositoryAnalysis, kind: DocumentationKind): string {
  const { repository, summary, languages, files } = analysis;
  const languageList = languages.slice(0, 8).map((language) => `${language.name} (${language.percent}%)`);
  const manifestList = summary.packageManifests?.map((manifest) => `\`${manifest.path}\` (${manifest.ecosystem})`) || [];
  const sourceFiles = files.filter((file) => file.kind === "source").slice(0, 24).map((file) => file.path);
  const apiFiles = files.filter((file) => /(^|\/)(api|routes?|controllers?|handlers?)(\/|$)/i.test(file.path)).slice(0, 24).map((file) => file.path);
  const configFiles = files.filter((file) => file.kind === "config").slice(0, 24).map((file) => file.path);
  const header = `# ${titles[kind]}\n\n> Generated from ${repository.fullName} at commit \`${repository.commit}\`. Verify changes against the pinned source before publishing.\n`;
  switch (kind) {
    case "readme":
      return `${header}\n## Overview\n\n${summary.purpose}\n\n## Technology\n\n${bullets(languageList, "No supported language data was detected.")}\n\n## Getting started\n\n${summary.installCommand ? `\`${summary.installCommand}\`` : "No install command was detected."}\n\n${summary.runCommand ? `Run with \`${summary.runCommand}\`.` : "No run command was detected."}\n\n## Repository map\n\n${bullets(summary.entryPoints, "No conventional entry point was detected.")}\n\n## Evidence\n\n- Files indexed: ${analysis.totalFiles.toLocaleString()}\n- Files sampled: ${analysis.scannedFiles}\n- Snapshot: \`${repository.commit}\`\n`;
    case "architecture":
      return `${header}\n## Purpose\n\n${summary.purpose}\n\n## Entry points\n\n${bullets(summary.entryPoints, "No conventional entry point was detected.")}\n\n## Framework signals\n\n${bullets(summary.frameworks, "No framework signal was detected.")}\n\n## Module areas\n\n${summary.directories.map((directory) => `- \`${directory.name}/\` — ${directory.count} files`).join("\n") || "- No nested directories were detected."}\n\n## Verified local imports\n\n- ${analysis.edges.length} local import edges were resolved from the bounded source sample.\n- The graph represents static imports, not runtime execution order.\n`;
    case "api":
      return `${header}\n## Detected API-like files\n\n${bullets(apiFiles, "No API, route, controller, or handler paths were detected.")}\n\n## Entry points\n\n${bullets(summary.entryPoints, "No conventional entry point was detected.")}\n\n## Limitations\n\nThis document reports file and import signals only. It does not infer undocumented endpoints or execute repository code.\n`;
    case "database":
      return `${header}\n## Detected database signals\n\n${bullets(files.filter((file) => /(^|\/)(db|database|migrations?|schema|models?)(\/|$)|\.(sql|prisma)$/i.test(file.path)).slice(0, 30).map((file) => file.path), "No database or schema files were detected.")}\n\n## Dependency manifests\n\n${bullets(manifestList, "No supported dependency manifests were detected.")}\n`;
    case "setup":
      return `${header}\n## Prerequisites\n\n- Node.js and npm where a Node manifest is present.\n- Use the repository's own toolchain for other detected manifests.\n\n## Commands\n\n${summary.packageManifests?.map((manifest) => `### ${manifest.path}\n\n- Install: ${manifest.installCommand ? `\`${manifest.installCommand}\`` : "Not detected"}\n- Run: ${manifest.runCommand ? `\`${manifest.runCommand}\`` : "Not detected"}\n- Test: ${manifest.testCommand ? `\`${manifest.testCommand}\`` : "Not detected"}`).join("\n\n") || "No supported manifest was scanned."}\n`;
    case "onboarding":
      return `${header}\n## First hour\n\n1. Read the repository overview and README.\n2. Start at ${summary.entryPoints[0] ? `\`${summary.entryPoints[0]}\`` : "the primary entry point"}.\n3. Inspect the architecture graph and resolved imports.\n4. Review recent commits and the files changed most often.\n5. Run the detected test command in a safe local environment.\n\n## Suggested files\n\n${bullets(sourceFiles, "No sampled source files were available.")}\n`;
    case "module":
      return `${header}\n## Sampled modules\n\n${bullets(sourceFiles, "No sampled source modules were available.")}\n\n## Dependency edges\n\n${analysis.edges.slice(0, 40).map((edge) => `- \`${edge.from}:${edge.line}\` imports \`${edge.to}\``).join("\n") || "- No local import edges were resolved."}\n`;
    case "environment":
      return `${header}\n## Configuration files\n\n${bullets(configFiles, "No supported configuration files were detected.")}\n\n## Environment-file signals\n\n${bullets(files.filter((file) => /(^|\/)\.env(?:\.|$)/i.test(file.path)).map((file) => file.path), "No environment files were detected.")}\n\nNever commit credentials. Values are intentionally not read or displayed by RepoMind.\n`;
  }
}
