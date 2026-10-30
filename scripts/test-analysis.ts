import assert from "node:assert/strict";
import { explainFileStructure, matchedLineWindows, parseManifestFiles, resolveLocalImport, symbolsFor } from "@/lib/analysis";
import { isCommitSha, isSafeTextPath, parseRepoUrl, rankSourcePath, sourceLanguage } from "@/lib/github";

const repo = parseRepoUrl("https://github.com/expressjs/express.git");
assert.deepEqual(repo, {
  owner: "expressjs",
  name: "express",
  fullName: "expressjs/express",
  url: "https://github.com/expressjs/express",
});
assert.equal(parseRepoUrl("http://github.com/owner/repo"), null);
assert.equal(parseRepoUrl("https://github.com.evil.test/owner/repo"), null);
assert.equal(parseRepoUrl("https://user@github.com/owner/repo"), null);
assert.equal(parseRepoUrl("https://github.com/owner/repo/tree/main"), null);
assert.equal(parseRepoUrl("https://github.com/owner/repo?tab=readme"), null);

assert.equal(isCommitSha("0123456789abcdef0123456789abcdef01234567"), true);
assert.equal(isCommitSha("main"), false);
assert.equal(isSafeTextPath("src/auth/login.ts"), true);
assert.equal(isSafeTextPath("../../secrets.ts"), false);
assert.equal(isSafeTextPath("node_modules/pkg/index.js"), false);
assert.equal(isSafeTextPath("assets/archive.zip"), false);
assert.equal(sourceLanguage("src/main.py"), "Python");
assert.equal(sourceLanguage("src/App.tsx"), "TypeScript");
assert.ok(rankSourcePath("README.md") > rankSourcePath("src/helpers.ts"));

const code = [
  'import { tokenStore } from "./token-store";',
  "export async function createToken(userId: string) {",
  "  return tokenStore.issue(userId);",
  "}",
  "export class SessionService {}",
].join("\n");
const parsed = symbolsFor("src/auth.ts", code);
assert.ok(parsed.symbols.includes("createToken"));
assert.ok(parsed.symbols.includes("SessionService"));
assert.deepEqual(parsed.imports[0], { specifier: "./token-store", line: 1 });

const windows = matchedLineWindows("src/auth.ts", code, "where does createToken issue the session token");
assert.equal(windows.length, 1);
assert.equal(windows[0].start, 1);
assert.match(windows[0].text, /createToken/);

const monorepo = parseManifestFiles(
  ["requirements.txt", "Frontend/package.json", "Frontend/package-lock.json", "action_agent/requirements.txt"],
  new Map([
    ["requirements.txt", "fastapi==0.110.0\nuvicorn>=0.27"],
    ["Frontend/package.json", JSON.stringify({ dependencies: { react: "^19.0.0" }, devDependencies: { vite: "^6.0.0" }, scripts: { dev: "vite", test: "vitest" } })],
    ["action_agent/requirements.txt", "openai==1.2.0"],
  ]),
);
assert.ok(monorepo.dependencies.some((dependency) => dependency.name === "react" && dependency.manifestPath === "Frontend/package.json"));
assert.ok(monorepo.dependencies.some((dependency) => dependency.name === "openai" && dependency.manifestPath === "action_agent/requirements.txt"));
const frontend = monorepo.manifests.find((manifest) => manifest.path === "Frontend/package.json");
assert.equal(frontend?.workingDirectory, "Frontend");
assert.equal(frontend?.installCommand, "npm ci");
assert.equal(frontend?.runCommand, "npm run dev");
assert.equal(frontend?.testCommand, "npm test");
assert.equal(resolveLocalImport("Frontend/src/App.tsx", "@/components/Card", new Set(["Frontend/src/components/Card.tsx"])), "Frontend/src/components/Card.tsx");
const entryExplanation = explainFileStructure("Frontend/src/main.tsx", `import ReactDOM from 'react-dom/client';\nimport App from './App';\nReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);`);
assert.match(entryExplanation, /browser entry point for a React application/);
assert.match(entryExplanation, /React\.StrictMode/);
assert.match(entryExplanation, /only the selected file/);

console.log("RepoMind analysis unit checks passed.");
