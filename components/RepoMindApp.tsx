"use client";

import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, Boxes, Braces, Check,
  ChevronDown, ChevronRight, CircleDot, Clock3, Code2, Command, Compass, Database,
  ExternalLink, FileCode2, FileText, FolderClosed, GitBranch, GitCommitHorizontal,
  GitFork, Globe2, Layers2, LayoutDashboard, LoaderCircle, LockKeyhole,
  MessageSquareText, Moon, Move, Network, PanelLeft, Plus, Search, Send, Settings2,
  ShieldCheck, Sparkles, Sun, TriangleAlert, X, Zap,
} from "lucide-react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RepoCommit, RepositoryAnalysis, SourceFile } from "@/lib/types";

type View = "overview" | "architecture" | "files" | "chat" | "documentation" | "pull-request" | "comparison" | "dependencies" | "history" | "getting-started";
type Theme = "dark" | "light";
type ExplanationLevel = "beginner" | "intermediate" | "advanced";
type Citation = { path: string; start: number; end: number; url: string };
type ChatMessage = { role: "user" | "assistant"; text: string; citations?: Citation[]; mode?: "ai" | "search" | "file" };
type DocumentationKind = "readme" | "architecture" | "api" | "database" | "setup" | "onboarding" | "module" | "environment";
type PullFinding = { severity: string; file: string; line: number | null; explanation: string; impact: string; fix: string; confidence: number };
type PullReport = { pull: { number: number; title: string; body: string | null; html_url: string; base: { ref: string }; head: { ref: string }; changed_files: number; additions: number; deletions: number }; files: { filename: string; status: string; additions: number; deletions: number; patch?: string }[]; findings: PullFinding[]; summary: string; mode: "ai" | "evidence" };
type ComparisonReport = { first: { repository: RepositoryAnalysis["repository"]; languages: RepositoryAnalysis["languages"]; frameworks: string[]; dependencies: { name: string; version: string; group: string }[]; files: number; sampledFiles: number; importEdges: number; testFiles: number; documentation: boolean; setup: { install: string | null; run: string | null; test: string | null } }; second: { repository: RepositoryAnalysis["repository"]; languages: RepositoryAnalysis["languages"]; frameworks: string[]; dependencies: { name: string; version: string; group: string }[]; files: number; sampledFiles: number; importEdges: number; testFiles: number; documentation: boolean; setup: { install: string | null; run: string | null; test: string | null } } };
type TreeNode = { name: string; path: string; children?: TreeNode[]; file?: RepositoryAnalysis["files"][number] };

const VIEWS: { id: View; label: string; icon: typeof LayoutDashboard; group: "workspace" | "intelligence" }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "workspace" },
  { id: "architecture", label: "Architecture", icon: Network, group: "workspace" },
  { id: "files", label: "File explorer", icon: FolderClosed, group: "workspace" },
  { id: "chat", label: "Repository chat", icon: MessageSquareText, group: "intelligence" },
  { id: "documentation", label: "Documentation", icon: FileText, group: "intelligence" },
  { id: "pull-request", label: "Pull request analysis", icon: GitFork, group: "intelligence" },
  { id: "comparison", label: "Repository comparison", icon: Move, group: "intelligence" },
  { id: "getting-started", label: "Getting started", icon: Compass, group: "intelligence" },
  { id: "dependencies", label: "Dependencies", icon: Boxes, group: "intelligence" },
  { id: "history", label: "Git insights", icon: GitCommitHorizontal, group: "intelligence" },
];

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#76a9fa", JavaScript: "#e8c969", Python: "#6da8dd", Java: "#d88861",
  Go: "#71c6c0", "C++": "#bf90e6", C: "#9ba8c6", HTML: "#dd855f", CSS: "#a586df",
  PHP: "#9298de", Ruby: "#e17978",
};
const CODE_TOKEN_PATTERN = /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|return|if|else|for|while|class|function|const|let|var|import|from|export|default|new|throw|try|catch|finally|def|self|pass|public|private|protected|static|void|int|String|boolean|func|fn|type|interface|extends|implements|this|super|yield|match|case|switch|break|continue|true|false|null|None|nil|undefined|package|module|require|as|in|is|with|raise|except|lambda)\b|\b\d+(?:\.\d+)?\b)/g;
const CODE_KEYWORDS = new Set(["async", "await", "return", "if", "else", "for", "while", "class", "function", "const", "let", "var", "import", "from", "export", "default", "new", "throw", "try", "catch", "finally", "def", "self", "pass", "public", "private", "protected", "static", "void", "int", "String", "boolean", "func", "fn", "type", "interface", "extends", "implements", "this", "super", "yield", "match", "case", "switch", "break", "continue", "true", "false", "null", "None", "nil", "undefined", "package", "module", "require", "as", "in", "is", "with", "raise", "except", "lambda"]);

function formatBytes(bytes: number = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeAgo(date: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString();
}

function buildTree(files: RepositoryAnalysis["files"]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let list = root;
    let current = "";
    parts.forEach((part, index) => {
      current = current ? `${current}/${part}` : part;
      let node = list.find((item) => item.name === part);
      if (!node) {
        node = index === parts.length - 1 ? { name: part, path: current, file } : { name: part, path: current, children: [] };
        list.push(node);
      }
      if (index < parts.length - 1) list = node.children || (node.children = []);
    });
  }
  const sort = (nodes: TreeNode[]) => nodes.sort((a, b) => {
    if (Boolean(a.children) !== Boolean(b.children)) return a.children ? -1 : 1;
    return a.name.localeCompare(b.name);
  }).forEach((node) => node.children && sort(node.children));
  sort(root);
  return root;
}

function matchSearch(path: string, query: string) {
  return path.toLowerCase().includes(query.toLowerCase());
}

function treeNodeMatches(node: TreeNode, query: string): boolean {
  return matchSearch(node.path, query) || Boolean(node.file?.symbols.some((symbol) => matchSearch(symbol, query))) || Boolean(node.children?.some((child) => treeNodeMatches(child, query)));
}

function CodeText({ value }: { value: string }) {
  return <>{value.split(CODE_TOKEN_PATTERN).map((part, index) => {
    if (!part) return null;
    const className = /^(\/\/|#)/.test(part) ? "syntax-comment" : /^(?:"|'|`)/.test(part) ? "syntax-string" : /^\d/.test(part) ? "syntax-number" : CODE_KEYWORDS.has(part) ? "syntax-keyword" : "";
    return className ? <span className={className} key={index}>{part}</span> : <span key={index}>{part}</span>;
  })}</>;
}

function IconButton({ title, onClick, children, className = "" }: { title: string; onClick: () => void; children: ReactNode; className?: string }) {
  return <button type="button" title={title} aria-label={title} onClick={onClick} className={`icon-button ${className}`}>{children}</button>;
}

function RepoMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "brand-mark-small" : ""}`}><Braces size={small ? 16 : 18} strokeWidth={2.25} /><i /></span>;
}

function GithubMark({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .95a11.05 11.05 0 0 0-3.49 21.53c.55.1.75-.24.75-.53v-2.06c-3.06.67-3.71-1.3-3.71-1.3-.5-1.27-1.22-1.61-1.22-1.61-1-.68.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.67 2.57 1.19 3.2.91.1-.71.38-1.19.7-1.47-2.45-.28-5.02-1.23-5.02-5.45 0-1.2.43-2.18 1.13-2.95-.12-.28-.49-1.4.1-2.92 0 0 .92-.3 3.04 1.13a10.6 10.6 0 0 1 5.53 0c2.11-1.43 3.03-1.13 3.03-1.13.6 1.52.22 2.64.11 2.92.7.77 1.12 1.75 1.12 2.95 0 4.23-2.57 5.16-5.03 5.44.4.35.75 1.02.75 2.06v3.06c0 .29.2.63.76.52A11.06 11.06 0 0 0 12 .95Z" /></svg>;
}

function TreeBranchView({ nodes, depth, expanded, onToggle, onSelect, activePath, query }: {
  nodes: TreeNode[]; depth: number; expanded: Set<string>; onToggle: (path: string) => void; onSelect: (path: string) => void; activePath: string; query: string;
}) {
  return <>{nodes.map((node) => {
    if (query && node.children) {
      const matching = node.children.filter((child) => treeNodeMatches(child, query));
      if (!matching.length && !matchSearch(node.path, query)) return null;
      return <div key={node.path}>
        <button className="tree-row tree-folder" style={{ paddingLeft: 12 + depth * 15 }} onClick={() => onToggle(node.path)}><ChevronDown size={13} /><FolderClosed size={14} /><span>{node.name}</span></button>
        <TreeBranchView nodes={matching} depth={depth + 1} expanded={expanded} onToggle={onToggle} onSelect={onSelect} activePath={activePath} query={query} />
      </div>;
    }
    if (node.children) return <div key={node.path}>
      <button className="tree-row tree-folder" style={{ paddingLeft: 12 + depth * 15 }} onClick={() => onToggle(node.path)}><span className="tree-caret">{expanded.has(node.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span><FolderClosed size={14} /><span>{node.name}</span></button>
      {(expanded.has(node.path) || query) && <TreeBranchView nodes={node.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} onSelect={onSelect} activePath={activePath} query={query} />}
    </div>;
    const file = node.file;
    if (query && !matchSearch(node.path, query) && !file?.symbols.some((symbol) => matchSearch(symbol, query))) return null;
    return <button key={node.path} className={`tree-row tree-file ${activePath === node.path ? "selected" : ""}`} style={{ paddingLeft: 26 + depth * 15 }} onClick={() => onSelect(node.path)} title={node.path}>
      <FileCode2 size={14} className={file?.kind === "test" ? "file-icon-test" : ""} /><span>{node.name}</span>
      {file?.importance === "critical" && <i className="tree-dot" title="Entry point" />}
    </button>;
  })}</>;
}

export function RepoMindApp() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [analysis, setAnalysis] = useState<RepositoryAnalysis | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [activeView, setActiveView] = useState<View>("overview");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [fileError, setFileError] = useState("");
  const [activeFile, setActiveFile] = useState("");
  const [source, setSource] = useState<SourceFile | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [lineFocus, setLineFocus] = useState<number | null>(null);
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const [fileSearch, setFileSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [history, setHistory] = useState<RepoCommit[] | null>(null);
  const [frequentFiles, setFrequentFiles] = useState<{ path: string; changes: number }[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [recentRepos, setRecentRepos] = useState<{ url: string; name: string }[]>([]);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [explanationLevel, setExplanationLevel] = useState<ExplanationLevel>("intermediate");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documentationKind, setDocumentationKind] = useState<DocumentationKind>("readme");
  const [documentationText, setDocumentationText] = useState("");
  const [documentationBusy, setDocumentationBusy] = useState(false);
  const [documentationError, setDocumentationError] = useState("");
  const [pullNumber, setPullNumber] = useState("");
  const [pullReport, setPullReport] = useState<PullReport | null>(null);
  const [pullBusy, setPullBusy] = useState(false);
  const [pullError, setPullError] = useState("");
  const [compareUrl, setCompareUrl] = useState("");
  const [comparison, setComparison] = useState<ComparisonReport | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const chatRequestId = useRef(0);
  const fileRequestId = useRef(0);

  useEffect(() => {
    const savedTheme = localStorage.getItem("repomind-theme");
    if (savedTheme === "light" || savedTheme === "dark") queueMicrotask(() => setTheme(savedTheme));
    try {
      const recent = JSON.parse(localStorage.getItem("repomind-recent") || "[]") as { url: string; name: string }[];
      queueMicrotask(() => setRecentRepos(recent.slice(0, 5)));
    } catch { /* Recent repositories are a convenience only. */ }
    const raw = sessionStorage.getItem("repomind-analysis");
    if (raw) {
      try {
        const restored = JSON.parse(raw) as RepositoryAnalysis;
        if (restored?.repository?.url && Array.isArray(restored.files)) {
        queueMicrotask(() => {
          setAnalysis(restored);
          setRepoInput(restored.repository.url);
        });
        }
      } catch { sessionStorage.removeItem("repomind-analysis"); }
    }
    fetch("/api/health").then((response) => response.json()).then((data) => setAiConfigured(Boolean(data.aiConfigured))).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("repomind-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (activeView !== "history" || !analysis || history || historyError) return;
    fetch(`/api/history?repo=${encodeURIComponent(analysis.repository.url)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load commit history.");
        setHistory(data.commits || []);
        setFrequentFiles(data.frequentFiles || []);
      })
      .catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : "Could not load commit history."))
  }, [activeView, analysis, history, historyError]);

  useEffect(() => {
    if (lineFocus && codeRef.current) {
      const line = codeRef.current.querySelector(`[data-line="${lineFocus}"]`);
      line?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [lineFocus, source]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((open) => !open); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") { event.preventDefault(); setAnalysis(null); sessionStorage.removeItem("repomind-analysis"); setRepoInput(""); setAnalysisError(""); }
      if (event.key === "Escape") { setCommandOpen(false); setMobileNavOpen(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && analysis) { event.preventDefault(); setActiveView("files"); setTimeout(() => searchRef.current?.focus(), 40); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [analysis]);

  const openRepository = useCallback(async (event?: FormEvent, urlOverride?: string) => {
    event?.preventDefault();
    const url = (urlOverride || repoInput).trim();
    if (!url) { setAnalysisError("Paste a public GitHub repository URL to begin."); return; }
    chatRequestId.current += 1;
    fileRequestId.current += 1;
    setChatBusy(false);
    setFileBusy(false);
    setRepoInput(url);
    setAnalysisError("");
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryUrl: url }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Repository analysis failed.");
      const nextAnalysis = data.analysis as RepositoryAnalysis;
      setAnalysis(nextAnalysis);
      setActiveView("overview");
      setMessages([]);
      setActiveFile("");
      setSource(null);
      setHistory(null);
      setHistoryError("");
      setChatError("");
      sessionStorage.setItem("repomind-analysis", JSON.stringify(nextAnalysis));
      try {
        const recent = JSON.parse(localStorage.getItem("repomind-recent") || "[]") as { url: string; name: string }[];
        const updated = [{ url: nextAnalysis.repository.url, name: nextAnalysis.repository.fullName }, ...recent.filter((item) => item.url !== nextAnalysis.repository.url)].slice(0, 5);
        localStorage.setItem("repomind-recent", JSON.stringify(updated));
        setRecentRepos(updated);
      } catch { /* Recent repositories are a convenience only. */ }
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Repository analysis failed. Please try again.");
    } finally { setIsAnalyzing(false); }
  }, [repoInput]);

  const changeView = (view: View) => { setActiveView(view); setMobileNavOpen(false); setGlobalSearch(""); };

  const openFile = useCallback(async (path: string, line?: number) => {
    if (!analysis) return;
    const requestId = ++fileRequestId.current;
    setActiveView("files");
    setMobileNavOpen(false);
    setActiveFile(path);
    setLineFocus(line || null);
    setFileError("");
    setFileBusy(true);
    setSource(null);
    try {
      const query = new URLSearchParams({ repo: analysis.repository.url, sha: analysis.repository.commit, path });
      const response = await fetch(`/api/file?${query.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load source file.");
      if (requestId !== fileRequestId.current) return;
      setSource(data.source as SourceFile);
    } catch (error) { if (requestId === fileRequestId.current) setFileError(error instanceof Error ? error.message : "Could not load source file."); }
    finally { if (requestId === fileRequestId.current) setFileBusy(false); }
  }, [analysis]);

  const askQuestion = async (event?: FormEvent, suggested?: string, filePath?: string) => {
    event?.preventDefault();
    if (!analysis || chatBusy) return;
    const question = (suggested || chatInput).trim();
    if (!question) return;
    setChatInput("");
    setChatError("");
    setMessages((current) => [...current, { role: "user", text: question }]);
    setChatBusy(true);
    const requestId = ++chatRequestId.current;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryUrl: analysis.repository.url, sha: analysis.repository.commit, question, level: explanationLevel, ...(filePath ? { filePath } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Repository chat failed.");
      if (requestId !== chatRequestId.current) return;
      setMessages((current) => [...current, { role: "assistant", text: data.answer, citations: data.citations || [], mode: data.mode }]);
    } catch (error) { if (requestId === chatRequestId.current) setChatError(error instanceof Error ? error.message : "Repository chat failed."); }
    finally { if (requestId === chatRequestId.current) setChatBusy(false); }
  };

  const clearConversation = () => {
    chatRequestId.current += 1;
    setChatBusy(false);
    setMessages([]);
    setChatError("");
    setChatInput("");
  };

  const generateDocs = async (kind = documentationKind, enhanceWithAi = false) => {
    if (!analysis) return;
    setDocumentationBusy(true);
    setDocumentationError("");
    try {
      const response = await fetch("/api/documentation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis, kind, enhanceWithAi }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Documentation generation failed.");
      setDocumentationKind(kind);
      setDocumentationText(data.markdown || "");
    } catch (error) {
      setDocumentationError(error instanceof Error ? error.message : "Documentation generation failed.");
    } finally { setDocumentationBusy(false); }
  };

  const analyzePullRequest = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!analysis || !pullNumber.trim()) return;
    setPullBusy(true);
    setPullError("");
    try {
      const response = await fetch("/api/pull-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryUrl: analysis.repository.url, number: Number(pullNumber) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Pull request analysis failed.");
      setPullReport(data as PullReport);
    } catch (error) {
      setPullError(error instanceof Error ? error.message : "Pull request analysis failed.");
    } finally { setPullBusy(false); }
  };

  const compareRepositories = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!analysis || !compareUrl.trim()) return;
    setCompareBusy(true);
    setCompareError("");
    try {
      const response = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firstUrl: analysis.repository.url, secondUrl: compareUrl.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Repository comparison failed.");
      setComparison(data as ComparisonReport);
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : "Repository comparison failed.");
    } finally { setCompareBusy(false); }
  };

  const tree = useMemo(() => analysis ? buildTree(analysis.files) : [], [analysis]);
  const filteredFiles = useMemo(() => analysis?.files.filter((file) => !globalSearch || matchSearch(file.path, globalSearch) || file.symbols.some((symbol) => matchSearch(symbol, globalSearch))) || [], [analysis, globalSearch]);
  const currentTitle = VIEWS.find((item) => item.id === activeView)?.label || "Overview";

  const chooseRecent = async (url: string) => { setRepoInput(url); await openRepository(undefined, url); };

  if (!analysis) return <LandingPage theme={theme} setTheme={setTheme} url={repoInput} setUrl={setRepoInput} onSubmit={openRepository} busy={isAnalyzing} error={analysisError} />;

  return <main className="app-shell">
    <div className={`mobile-backdrop ${mobileNavOpen ? "visible" : ""}`} onClick={() => setMobileNavOpen(false)} />
    <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-brand"><a href="#overview" className="brand-lockup" onClick={(event) => { event.preventDefault(); changeView("overview"); }}><RepoMark /><span>repo<span className="brand-light">mind</span></span></a><IconButton title="Close navigation" className="mobile-close" onClick={() => setMobileNavOpen(false)}><X size={17} /></IconButton></div>
      <button className="new-analysis" onClick={() => { setAnalysis(null); sessionStorage.removeItem("repomind-analysis"); setRepoInput(""); setAnalysisError(""); }}><Plus size={16} /><span>New analysis</span><kbd>⌘ N</kbd></button>
      <div className="sidebar-repo-label"><span>RECENT REPOSITORY</span><ChevronDown size={13} /></div>
      <button className="current-repo-pill" onClick={() => changeView("overview")} title={analysis.repository.fullName}><span className="repo-avatar">{analysis.repository.name.charAt(0).toUpperCase()}</span><span className="repo-label"><strong>{analysis.repository.name}</strong><small>{analysis.repository.owner}</small></span><span className="repo-status-dot" /></button>
      {recentRepos.filter((repo) => repo.url !== analysis.repository.url).slice(0, 4).map((repo) => <button className="recent-repo-pill" key={repo.url} onClick={() => void chooseRecent(repo.url)} title={`Analyze ${repo.name}`}><span className="recent-repo-mark">{repo.name.split("/").at(-1)?.charAt(0).toUpperCase()}</span><span>{repo.name.split("/").at(-1)}</span><ArrowUpRight size={12} /></button>)}
      <nav className="side-nav" aria-label="Repository workspace">
        <span className="nav-section-label">WORKSPACE</span>
        {VIEWS.filter((item) => item.group === "workspace").map((item) => <NavItem key={item.id} item={item} selected={activeView === item.id} onClick={() => changeView(item.id)} />)}
        <span className="nav-section-label nav-section-spaced">TOOLS</span>
        {VIEWS.filter((item) => item.group === "intelligence").map((item) => <NavItem key={item.id} item={item} selected={activeView === item.id} onClick={() => changeView(item.id)} />)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-help"><CircleDot size={15} /><span>Read-only, source-linked analysis</span><ShieldCheck size={14} className="help-check" /></div>
        <div className="sidebar-user"><span className="user-avatar">RM</span><span><strong>Local workspace</strong><small>No account connected</small></span><Settings2 size={15} /></div>
      </div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div className="topbar-left"><IconButton title="Open navigation" className="mobile-menu" onClick={() => setMobileNavOpen(true)}><PanelLeft size={18} /></IconButton><div className="breadcrumbs"><span className="crumb-muted">{analysis.repository.owner}</span><ChevronRight size={14} /><strong>{analysis.repository.name}</strong><span className="branch-chip"><GitBranch size={12} />{analysis.repository.defaultBranch}</span></div></div>
        <div className="topbar-actions"><span className="commit-chip" title={analysis.repository.commit}><GitCommitHorizontal size={14} />{analysis.repository.commit.slice(0, 7)}</span><label className="global-search"><Search size={15} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} onFocus={() => { if (globalSearch) changeView("files"); }} placeholder="Search files and symbols" /><kbd>⌘ K</kbd>{globalSearch && <button onClick={() => setGlobalSearch("")}><X size={13} /></button>}</label><IconButton title="Toggle color theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</IconButton><a className="github-link" href={analysis.repository.url} target="_blank" rel="noreferrer" title="Open repository on GitHub"><GithubMark size={17} /></a></div>
      </header>
      {globalSearch && <div className="search-results-popover"><div className="search-popover-heading"><span>FILES & SYMBOLS</span><button onClick={() => setGlobalSearch("")}><X size={14} /></button></div>{filteredFiles.slice(0, 8).map((file) => <button key={file.path} onClick={() => { setGlobalSearch(""); void openFile(file.path); }}><FileCode2 size={15} /><span><strong>{file.path.split("/").at(-1)}</strong><small>{file.path}</small></span><ArrowUpRight size={14} /></button>)}{!filteredFiles.length && <p>No matching files in the indexed tree.</p>}</div>}

      <div className="page-wrap"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />{currentTitle.toUpperCase()}</div><h1>{activeView === "overview" ? "Repository overview" : currentTitle}</h1><p>{viewSubtitle(activeView, analysis)}</p></div>{activeView === "overview" && <a className="outline-button" href={`${analysis.repository.url}/tree/${analysis.repository.defaultBranch}`} target="_blank" rel="noreferrer"><GithubMark size={15} /> View on GitHub <ExternalLink size={13} /></a>}</div>
        {analysis.truncated && <div className="notice notice-warn"><TriangleAlert size={16} /><span>The file tree contains more files than the explorer limit; counts use the full GitHub tree while interactive file search shows the first 4,000 ranked paths.</span></div>}
        {analysis.scannedFiles < analysis.totalFiles && <div className="notice notice-info"><Code2 size={15} /><span>The scan sampled {analysis.scannedFiles} source and manifest files; {analysis.totalFiles.toLocaleString()} paths are indexed. Other supported text files load when opened.</span></div>}
        {activeView === "overview" && <OverviewView analysis={analysis} openFile={openFile} setView={changeView} />}
        {activeView === "architecture" && <ArchitectureView analysis={analysis} openFile={openFile} />}
        {activeView === "files" && <FileExplorer analysis={analysis} tree={tree} expanded={treeExpanded} setExpanded={setTreeExpanded} search={fileSearch} setSearch={setFileSearch} activeFile={activeFile} openFile={openFile} source={source} busy={fileBusy} error={fileError} lineFocus={lineFocus} codeRef={codeRef} searchRef={searchRef} explainFile={(path) => { clearConversation(); changeView("chat"); void askQuestion(undefined, "Explain this file", path); }} />}
        {activeView === "chat" && <ChatView analysis={analysis} messages={messages} input={chatInput} setInput={setChatInput} busy={chatBusy} error={chatError} ask={askQuestion} openFile={openFile} aiConfigured={aiConfigured} clearConversation={clearConversation} level={explanationLevel} setLevel={setExplanationLevel} />}
        {activeView === "documentation" && <DocumentationView analysis={analysis} kind={documentationKind} setKind={setDocumentationKind} text={documentationText} setText={setDocumentationText} busy={documentationBusy} error={documentationError} generate={generateDocs} aiConfigured={aiConfigured} />}
        {activeView === "pull-request" && <PullRequestView number={pullNumber} setNumber={setPullNumber} report={pullReport} busy={pullBusy} error={pullError} analyze={analyzePullRequest} />}
        {activeView === "comparison" && <ComparisonView analysis={analysis} url={compareUrl} setUrl={setCompareUrl} report={comparison} busy={compareBusy} error={compareError} compare={compareRepositories} />}
        {activeView === "dependencies" && <DependenciesView analysis={analysis} openFile={openFile} />}
        {activeView === "history" && <HistoryView analysis={analysis} commits={history} frequentFiles={frequentFiles} busy={!history && !historyError} error={historyError} onRetry={() => { setHistory(null); setHistoryError(""); }} />}
        {activeView === "getting-started" && <GettingStartedView analysis={analysis} openFile={openFile} />}
        <footer className="workspace-footer"><span><RepoMark small /> RepoMind <span className="footer-muted">· Public repositories only</span></span><span>Snapshot <code>{analysis.repository.commit.slice(0, 7)}</code> · {new Date(analysis.repository.analyzedAt).toLocaleString()}</span></footer>
      </div>
    </section>
    {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onChoose={(view) => { changeView(view); setCommandOpen(false); }} />}
  </main>;
}

function NavItem({ item, selected, onClick }: { item: typeof VIEWS[number]; selected: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={`nav-item ${selected ? "nav-selected" : ""}`} onClick={onClick}><Icon size={16} strokeWidth={selected ? 2.1 : 1.8} /><span>{item.label}</span>{item.id === "chat" && <span className="nav-ai-dot" />}</button>;
}

function viewSubtitle(view: View, analysis: RepositoryAnalysis) {
  const subtitles: Record<View, string> = {
    overview: `${analysis.repository.fullName} · default branch ${analysis.repository.defaultBranch}`,
    architecture: "A static map of modules and import relationships found in the selected snapshot.",
    files: "Browse the repository tree, inspect symbols, and open source at its exact commit.",
    chat: "Ask a question and receive source-backed matches from this exact commit.",
    documentation: "Generate editable Markdown from verified repository signals, with optional server-side AI enhancement.",
    "pull-request": "Inspect a public pull request without approving, merging, or publishing comments.",
    comparison: "Compare two public repositories using the same bounded analysis engine and evidence-based metrics.",
    dependencies: "Explore manifest dependencies and locally resolved imports.",
    history: "Recent public commits and files touched in the sampled changes.",
    "getting-started": "Run setup commands from each supported manifest and inspect real project signals.",
  };
  return subtitles[view];
}

function LandingPage({ theme, setTheme, url, setUrl, onSubmit, busy, error }: {
  theme: Theme; setTheme: (theme: Theme) => void; url: string; setUrl: (url: string) => void; onSubmit: (event?: FormEvent, override?: string) => void; busy: boolean; error: string;
}) {
  const sampleUrl = "https://github.com/expressjs/express";
  return <main className="landing-shell">
    <div className="landing-noise" />
    <header className="landing-nav"><a className="brand-lockup" href="#home"><RepoMark /><span>repo<span className="brand-light">mind</span></span></a><nav><a href="#product">Product</a><a href="#workflow">How it works</a><a href="#trust">Trust & safety</a></nav><div className="landing-nav-actions"><button className="landing-theme" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button><a className="nav-signin" href="#analyze">Open workspace <ArrowUpRight size={14} /></a></div></header>
    <section className="hero-section" id="home"><div className="hero-grid" /><div className="hero-copy"><div className="hero-kicker"><span className="pulse-mark" /> REPOSITORY INTELLIGENCE, GROUNDED IN CODE</div><h1>Understand any codebase.<br /><span>Without reading every file.</span></h1><p className="hero-description">Turn public GitHub repositories into source-linked architecture, useful code explanations, and a first-hour onboarding plan.</p>
      <form className="repo-form" id="analyze" onSubmit={(event) => onSubmit(event)}><div className="repo-input-wrap"><GithubMark size={19} /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repository" aria-label="Public GitHub repository URL" /><span className="input-lock"><LockKeyhole size={13} /> Public repos</span></div><button className="analyze-button" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} /> Reading repository…</> : <>Analyze repository <ArrowRight size={17} /></>}</button></form>
      {error && <div className="landing-error"><TriangleAlert size={15} /> {error}</div>}
      <div className="example-row"><span>Try a real repository</span><button disabled={busy} onClick={() => onSubmit(undefined, sampleUrl)}><span className="sample-avatar">E</span> expressjs/express <ArrowUpRight size={13} /></button><i /><span>Public data only</span></div>
      <div className="hero-quiet-note"><ShieldCheck size={14} /> Read-only scan · bounded file sizes · repository code is never executed</div>
    </div><HeroPreview /></section>
    <section className="trust-strip" id="trust"><span><span className="trust-dot" /> Grounded in source</span><span><span className="trust-dot" /> Commit pinned</span><span><span className="trust-dot" /> No repo code execution</span><span><span className="trust-dot" /> AI key stays server-side</span></section>
    <section className="feature-section" id="product"><div className="section-overline">A clearer way into unfamiliar code</div><div className="section-heading-row"><h2>From “where do I start?”<br /><span>to a map you can trust.</span></h2><p>RepoMind starts with the repository’s actual files and commit. Every view keeps that source close, so you can move from a useful overview to the code behind it.</p></div>
      <div className="feature-grid"><FeatureTile number="01" icon={<Network size={19} />} title="See how modules connect" text="Explore resolved imports from the sampled source and open any connected file at its pinned commit." /><FeatureTile number="02" icon={<FileCode2 size={19} />} title="Find the code that matters" text="Search files and extracted symbols, inspect exact source lines, and see the scan scope clearly." /><FeatureTile number="03" icon={<MessageSquareText size={19} />} title="Ask with evidence attached" text="Search source directly or connect an OpenAI-compatible model for a synthesized, cited explanation." /><FeatureTile number="04" icon={<BookOpen size={19} />} title="Get project setup steps" text="See install, run, and test commands for each supported package manifest." /></div>
    </section>
    <section className="workflow-section" id="workflow"><div className="workflow-copy"><div className="section-overline">HOW IT WORKS</div><h2>A useful map begins<br />with <span>real evidence.</span></h2><p>One public URL. A pinned commit. A bounded scan. RepoMind doesn’t clone or run repository code, and it gives you the source behind each insight.</p><a href="#analyze" className="text-link">Analyze a repository <ArrowRight size={15} /></a></div><div className="workflow-steps"><WorkflowStep number="01" title="Paste a GitHub URL" body="We validate the public repository and read its metadata and default branch." /><WorkflowStep number="02" title="Build a bounded index" body="A limited source sample powers language, symbol, import, setup, and TODO signals." /><WorkflowStep number="03" title="Explore and ask" body="Move through the source map, inspect files, review history, and ask evidence-based questions." /></div></section>
    <section className="bottom-cta"><div className="bottom-cta-icon"><Sparkles size={19} /></div><div><h2>Start with the repository.<br /><span>Find your next step.</span></h2><p>Try it on any public GitHub project.</p></div><a href="#analyze" className="analyze-button">Analyze a repository <ArrowRight size={16} /></a></section>
    <footer className="landing-footer"><a className="brand-lockup" href="#home"><RepoMark small /><span>repo<span className="brand-light">mind</span></span></a><span>Understand any codebase. Start contributing sooner.</span><div><a href="https://docs.github.com/en/rest" target="_blank" rel="noreferrer">GitHub API <ExternalLink size={12} /></a><a href="https://github.com/" target="_blank" rel="noreferrer">GitHub <ExternalLink size={12} /></a></div></footer>
  </main>;
}

function HeroPreview() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setOffset({ x: Math.max(-44, Math.min(44, active.originX + event.clientX - active.startX)), y: Math.max(-26, Math.min(26, active.originY + event.clientY - active.startY)) });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onHandleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 20 : 8;
    const delta = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null;
    if (event.key === "Home") { event.preventDefault(); setOffset({ x: 0, y: 0 }); return; }
    if (!delta) return;
    event.preventDefault();
    setOffset((current) => ({ x: Math.max(-44, Math.min(44, current.x + delta[0])), y: Math.max(-26, Math.min(26, current.y + delta[1])) }));
  };
  return <div className="hero-visual" aria-label="Illustration of repository workspace"><div className="preview-glow" /><div className={dragging ? "preview-window preview-dragging" : "preview-window"} style={{"--drag-x":String(offset.x)+"px","--drag-y":String(offset.y)+"px"} as CSSProperties}><div className="preview-titlebar"><div className="window-dots"><i /><i /><i /></div><span>repomind / your-repository</span><span className="preview-commit"><GitCommitHorizontal size={12} /> commit after scan</span><button type="button" className="preview-drag-handle" aria-label="Move the project preview" title="Drag to move; use arrow keys to nudge" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onHandleKeyDown}><Move size={13} /></button></div><div className="preview-body"><div className="preview-sidebar"><div className="preview-logo"><RepoMark small /> workspace</div><span className="preview-active"><LayoutDashboard size={12} /> Overview</span><span><Network size={12} /> Architecture</span><span><FolderClosed size={12} /> File explorer</span><span><MessageSquareText size={12} /> Repository chat</span><div className="preview-side-foot">ILLUSTRATIVE WORKSPACE</div></div><div className="preview-main"><div className="preview-label">ILLUSTRATIVE LAYOUT · METRICS LOAD AFTER SCAN</div><div className="preview-heading">your-repository <span>branch</span></div><div className="preview-desc">Repository-specific details appear after a public source scan.</div><div className="preview-stats"><div><small>FILES</small><b>—</b></div><div><small>LANGUAGES</small><b>—</b></div><div><small>IMPORT LINKS</small><b>—</b></div></div><div className="preview-panels"><div className="preview-graph"><span>MODULE MAP <i>layout example</i></span><div className="mini-graph"><i className="mg-line l1" /><i className="mg-line l2" /><i className="mg-line l3" /><b className="mg-node m1">file 01</b><b className="mg-node m2">file 02</b><b className="mg-node m3">file 03</b><b className="mg-node m4">file 04</b></div></div><div className="preview-language"><span>LANGUAGES</span><div className="lang-row"><i className="lang-dot ts" /> JavaScript <b>—</b></div><div className="lang-row"><i className="lang-dot json" /> JSON <b>—</b></div><div className="lang-row"><i className="lang-dot md" /> Markdown <b>—</b></div><div className="mini-bar" /></div></div><div className="preview-chat"><span className="mini-spark"><Sparkles size={12} /></span><div><b>Ask about this repository</b><p>Open source references from the selected commit.</p></div><span className="mini-cite">source refs</span></div></div></div></div><div className="floating-note note-source"><span><Check size={12} /></span> Sources linked after scan</div><div className="floating-note note-commit"><GitCommitHorizontal size={13} /> Commit pinned after scan</div></div>;
}

function FeatureTile({ number, icon, title, text }: { number: string; icon: ReactNode; title: string; text: string }) {
  return <article className="feature-tile"><div className="feature-top"><span>{number}</span><i>{icon}</i></div><h3>{title}</h3><p>{text}</p><div className="feature-arrow"><ArrowUpRight size={15} /></div></article>;
}

function WorkflowStep({ number, title, body }: { number: string; title: string; body: string }) {
  return <div className="workflow-step"><span>{number}</span><div><h3>{title}</h3><p>{body}</p></div><i><ArrowDownRight size={15} /></i></div>;
}

function StatCard({ label, value, note, icon, accent = "" }: { label: string; value: string | number; note: string; icon: ReactNode; accent?: string }) {
  return <div className="stat-card"><div className="stat-card-top"><span>{label}</span><i className={accent}>{icon}</i></div><strong>{value}</strong><small>{note}</small></div>;
}

function OverviewView({ analysis, openFile, setView }: { analysis: RepositoryAnalysis; openFile: (path: string, line?: number) => void; setView: (view: View) => void }) {
  const languageGradient = useMemo(() => {
    const stops = analysis.languages.slice(0, 6).map((language, index) => {
      const start = analysis.languages.slice(0, index).reduce((sum, item) => sum + item.percent, 0);
      const end = start + language.percent;
      const color = LANGUAGE_COLORS[language.name] || ["#79b6aa", "#c28ddd", "#d5a46a", "#7892c5"][index % 4];
      return `${color} ${start}% ${end}%`;
    });
    return stops.length ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(var(--line) 0 100%)";
  }, [analysis.languages]);
  const importFileCount = new Set(analysis.edges.flatMap((edge) => [edge.from, edge.to])).size;
  const important = analysis.files.filter((file) => file.importance === "critical" || file.importance === "important").slice(0, 6);
  const stats = [
    { label: "FILES INDEXED", value: analysis.totalFiles.toLocaleString(), note: `${analysis.files.length.toLocaleString()} shown in explorer`, icon: <FileText size={16} /> },
    { label: "LANGUAGES", value: analysis.languages.length, note: analysis.languages.slice(0, 2).map((language) => language.name).join(" · ") || "No supported source found", icon: <Code2 size={16} /> },
    { label: "IMPORT LINKS", value: analysis.edges.length, note: `${importFileCount} files connected in scan`, icon: <Network size={16} /> },
    { label: "DEPENDENCIES", value: analysis.dependencies.length, note: "Read from scanned manifests", icon: <Boxes size={16} /> },
  ];
  return <div className="overview-content">
    <section className="repo-banner"><div className="repo-banner-main"><span className="repo-avatar repo-avatar-large">{analysis.repository.name.charAt(0).toUpperCase()}</span><div><div className="repo-title-row"><h2>{analysis.repository.name}</h2><span className="visibility-chip"><Globe2 size={12} /> Public</span></div><a href={analysis.repository.url} target="_blank" rel="noreferrer">{analysis.repository.fullName}<ExternalLink size={12} /></a><p>{analysis.summary.purpose}</p></div></div><div className="repo-banner-meta"><div><GitBranch size={14} /><span>{analysis.repository.defaultBranch}</span></div><div><GitCommitHorizontal size={14} /><code>{analysis.repository.commit.slice(0, 7)}</code></div><div><StarIcon /><span>{analysis.repository.stars.toLocaleString()}</span></div><div><GitFork size={14} /><span>{analysis.repository.forks.toLocaleString()}</span></div><div><Clock3 size={14} /><span>Analyzed {timeAgo(analysis.repository.analyzedAt)}</span></div></div><div className="repo-banner-tags">{analysis.summary.frameworks.map((framework) => <span key={framework}>{framework}</span>)}{analysis.repository.license && <span>{analysis.repository.license}</span>}<span className="scan-tag"><ShieldCheck size={12} /> Static scan</span></div></section>
    <div className="stat-grid">{stats.map((stat, index) => <StatCard key={stat.label} {...stat} accent={index === 2 ? "accent-mint" : ""} />)}</div>
    <div className="overview-grid">
      <section className="panel language-panel"><PanelHeader title="Language profile" action="Browse files" onAction={() => setView("files")} /><div className="language-content"><div className="language-donut" style={{ background: languageGradient } as CSSProperties}><div><strong>{analysis.languages.length}</strong><span>languages</span></div></div><div className="language-legend">{analysis.languages.slice(0, 6).map((language) => <div className="language-legend-row" key={language.name}><i style={{ background: LANGUAGE_COLORS[language.name] || "#8d94ab" }} /><span>{language.name}</span><b>{language.percent}%</b></div>)}{!analysis.languages.length && <span className="muted-copy">No supported source languages were identified.</span>}</div></div><div className="language-foot"><span>Measured from tracked source-file sizes</span><span>{formatBytes(analysis.totalSampleBytes)} read for analysis</span></div></section>
      <section className="panel modules-panel"><PanelHeader title="Connected modules" action="Open architecture" onAction={() => setView("architecture")} /><div className="module-summary"><span className="module-icon"><Layers2 size={17} /></span><div><strong>{analysis.edges.length ? `${importFileCount} files linked by imports` : "No local imports resolved"}</strong><small>{analysis.scannedFiles} files sampled · {analysis.edges.length} resolved links</small></div></div><div className="module-list">{analysis.edges.slice(0, 5).map((edge, index) => <button key={`${edge.from}-${edge.to}-${index}`} onClick={() => openFile(edge.from, edge.line)}><span className="module-file-icon"><FileCode2 size={14} /></span><span><b>{edge.from.split("/").at(-1)}</b><small>{edge.from} → {edge.to}</small></span><span className="module-line">L{edge.line}</span></button>)}{!analysis.edges.length && <div className="empty-inline">The sampled files did not contain resolvable relative imports. Open the explorer to inspect the indexed source.</div>}</div></section>
      <section className="panel important-panel"><PanelHeader title="Start here" action="View file tree" onAction={() => setView("files")} /><div className="important-list">{important.map((file) => <button key={file.path} onClick={() => openFile(file.path)}><span className={`importance-mark importance-${file.importance}`}><FileCode2 size={15} /></span><span><b>{file.path.split("/").at(-1)}</b><small>{file.path}</small></span><span className="importance-tag">{file.importance}</span><ChevronRight size={15} /></button>)}{!important.length && <div className="empty-inline">No entry-point or service paths were identified in the current file tree.</div>}</div></section>
      <section className="panel repo-snapshot"><PanelHeader title="Snapshot details" /><div className="snapshot-rows"><SnapshotRow label="Default branch" value={analysis.repository.defaultBranch} icon={<GitBranch size={14} />} /><SnapshotRow label="Commit" value={analysis.repository.commit.slice(0, 12)} icon={<GitCommitHorizontal size={14} />} mono /><SnapshotRow label="Repository size" value={`${(analysis.repository.sizeKb / 1024).toFixed(1)} MB`} icon={<Database size={14} />} /><SnapshotRow label="License" value={analysis.repository.license || "Not detected"} icon={<ShieldCheck size={14} />} /><SnapshotRow label="Files sampled" value={`${analysis.scannedFiles} files · ${formatBytes(analysis.totalSampleBytes)}`} icon={<FileCode2 size={14} />} /></div><div className="snapshot-callout"><Zap size={14} /><span>Analysis is pinned to this commit. Re-run to inspect a newer snapshot.</span></div></section>
    </div>
    <div className="overview-bottom"><div className="bottom-tip"><span><Sparkles size={15} /></span><div><b>Ready to work on this project?</b><p>See setup commands from detected manifests and review real TODO notes.</p></div><button onClick={() => setView("getting-started")}>Getting started <ArrowRight size={14} /></button></div><div className="purpose-note"><span className="note-icon"><BookOpen size={15} /></span><div><b>Repository purpose</b><p>{analysis.repository.description ? "Description from GitHub repository metadata." : analysis.summary.readmePath ? `Introductory text from ${analysis.summary.readmePath}.` : "No description was available from the repository metadata or sampled README."}</p></div></div></div>
  </div>;
}

function StarIcon() { return <span className="star-icon">★</span>; }
function PanelHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="panel-header"><h3>{title}</h3>{action && <button onClick={onAction}>{action} <ArrowUpRight size={13} /></button>}</div>;
}
function SnapshotRow({ label, value, icon, mono = false }: { label: string; value: string; icon: ReactNode; mono?: boolean }) {
  return <div className="snapshot-row"><span>{icon}{label}</span><b className={mono ? "mono-value" : ""}>{value}</b></div>;
}

function ArchitectureView({ analysis, openFile }: { analysis: RepositoryAnalysis; openFile: (path: string, line?: number) => void }) {
  const nodes = useMemo(() => {
    const linked = new Set(analysis.edges.flatMap((edge) => [edge.from, edge.to]));
    const fromGraph = analysis.files.filter((file) => linked.has(file.path) && file.scanned);
    const fallback = analysis.files.filter((file) => file.scanned && file.kind === "source");
    return (fromGraph.length ? fromGraph : fallback).slice(0, 9);
  }, [analysis]);
  const coords = useMemo(() => new Map(nodes.map((node, index) => [node.path, { x: 155 + (index % 3) * 340, y: 120 + Math.floor(index / 3) * 175 }])), [nodes]);
  const edges = analysis.edges.filter((edge) => coords.has(edge.from) && coords.has(edge.to));
  return <div className="architecture-content">
    <div className="architecture-toolbar"><div className="graph-legend"><span><i className="legend-node" /> Sampled source file</span><span><i className="legend-line" /> Resolved local import</span></div><span className="graph-count"><Network size={14} /> {nodes.length} files · {edges.length} links shown</span></div>
    <section className="panel architecture-panel"><div className="graph-topline"><div><b>Module relationship map</b><span>Built from source imports resolved against files in this commit</span></div><span className="static-badge"><ShieldCheck size={12} /> Static analysis</span></div>
      {nodes.length ? <div className="graph-canvas">
        <svg className="graph-edges" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-label="Import relationship connectors"><defs><marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><polygon points="0 0, 7 3.5, 0 7" fill="var(--graph-edge)" /></marker></defs>{edges.map((edge, index) => {
          const from = coords.get(edge.from)!; const to = coords.get(edge.to)!;
          return <g key={`${edge.from}-${edge.to}-${index}`}><path d={`M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`} markerEnd="url(#arrowhead)" /><title>{edge.from} imports {edge.to} at line {edge.line}</title></g>;
        })}</svg>
        {nodes.map((node, index) => {
          const point = coords.get(node.path)!;
          return <button key={node.path} className={`graph-node graph-node-${index % 4}`} style={{ left: `${point.x / 10}%`, top: `${point.y / 6.2}%` }} onClick={() => openFile(node.path)} title={`Open ${node.path}`}><span className="graph-node-icon"><FileCode2 size={15} /></span><span><b>{node.path.split("/").at(-1)}</b><small>{node.path}</small></span><ArrowUpRight size={13} /></button>;
        })}
        {!edges.length && <div className="graph-empty-overlay"><span><Network size={17} /></span><b>No local import links were resolved</b><small>Nodes show sampled source files. Some languages use module syntax that this static scanner does not resolve yet.</small></div>}
      </div> : <EmptyState icon={<Network size={20} />} title="No source files available for the map" body="The repository tree was read, but the bounded source sample contained no supported source files." />}
    </section>
    <div className="architecture-detail-grid"><section className="panel"><PanelHeader title="Resolved import links" /><div className="resolved-links">{edges.slice(0, 14).map((edge, index) => <button key={`${edge.from}-${edge.to}-${index}`} onClick={() => openFile(edge.from, edge.line)}><span><FileCode2 size={14} />{edge.from}</span><ArrowRight size={13} /><span><FileCode2 size={14} />{edge.to}</span><small>line {edge.line}</small></button>)}{!edges.length && <div className="empty-inline">No file-to-file import could be verified within the scanned source.</div>}</div></section><section className="panel"><PanelHeader title="How to read this map" /><div className="explain-list"><div><span className="explain-number">01</span><p><b>Edges mean imports.</b> Each connection is tied to an import statement that resolved to a file in this commit.</p></div><div><span className="explain-number">02</span><p><b>Missing edges are expected.</b> Dynamic imports, aliases, and runtime calls may not be recognized.</p></div><div><span className="explain-number">03</span><p><b>This is not execution order.</b> Open <button className="inline-link" onClick={() => openFile(analysis.summary.entryPoints[0] || nodes[0]?.path)}>a starting file</button> to trace a path manually.</p></div></div></section></div>
  </div>;
}

function FileExplorer({ analysis, tree, expanded, setExpanded, search, setSearch, activeFile, openFile, source, busy, error, lineFocus, codeRef, searchRef, explainFile }: {
  analysis: RepositoryAnalysis; tree: TreeNode[]; expanded: Set<string>; setExpanded: (next: Set<string>) => void; search: string; setSearch: (value: string) => void; activeFile: string; openFile: (path: string, line?: number) => void; source: SourceFile | null; busy: boolean; error: string; lineFocus: number | null; codeRef: React.RefObject<HTMLDivElement | null>; searchRef: React.RefObject<HTMLInputElement | null>; explainFile: (path: string) => void;
}) {
  const selected = analysis.files.find((file) => file.path === activeFile);
  const loadedSource = source?.path === activeFile ? source : null;
  const visibleSymbols = loadedSource?.symbols || selected?.symbols || [];
  const visibleImports = loadedSource?.imports?.map((item) => item.specifier) || selected?.imports || [];
  const toggle = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path); else next.add(path);
    setExpanded(next);
  };
  const allSourceLines = source?.content.replace(/\r/g, "").split("\n") || [];
  const sourceLines = allSourceLines.slice(0, 15_000);
  const linesTruncated = allSourceLines.length > sourceLines.length;
  return <div className="file-explorer-layout">
    <section className="panel file-tree-panel"><div className="tree-head"><div><b>Repository files</b><span>{analysis.files.length.toLocaleString()} paths indexed</span></div><button title="Expand top-level folders" onClick={() => setExpanded(new Set(tree.filter((node) => node.children).map((node) => node.path)))}><ChevronDown size={15} /></button></div><label className="tree-search"><Search size={14} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter paths or symbols" /><kbd>/</kbd>{search && <button onClick={() => setSearch("")}><X size={13} /></button>}</label><div className="tree-scroll"><TreeBranchView nodes={tree} depth={0} expanded={expanded} onToggle={toggle} onSelect={(path) => openFile(path)} activePath={activeFile} query={search} />{analysis.files.length === 0 && <EmptyState icon={<FolderClosed size={18} />} title="No files to display" body="GitHub returned an empty repository tree." />}</div><div className="tree-footer"><span><i className="tree-footer-dot" /> Commit pinned</span><span>{analysis.repository.commit.slice(0, 7)}</span></div></section>
    <section className="panel source-panel"><div className="source-toolbar"><div className="source-path"><FileCode2 size={15} /><span>{activeFile || "Select a file"}</span>{selected && <span className={`importance-tag importance-chip-${selected.importance}`}>{selected.importance}</span>}</div>{source && <a href={`${analysis.repository.url}/blob/${analysis.repository.commit}/${encodeURI(source.path)}`} target="_blank" rel="noreferrer" className="source-github-link">View on GitHub <ExternalLink size={12} /></a>}</div>
      {busy ? <LoadingState message="Loading this file from the selected commit…" /> : error ? <div className="source-empty"><TriangleAlert size={21} /><b>Source could not be loaded</b><p>{error}</p><button className="outline-button" onClick={() => activeFile && openFile(activeFile, lineFocus || undefined)}>Retry</button></div> : source ? <>
        <div className="source-meta"><span>{source.language}</span><i /> <span>{formatBytes(source.size)}</span><i /> <span>{linesTruncated ? `${sourceLines.length.toLocaleString()}+ lines` : `${sourceLines.length.toLocaleString()} lines`}</span><span className="source-snapshot"><GitCommitHorizontal size={12} /> {analysis.repository.commit.slice(0, 7)}</span></div>
        <div className="code-scroll" ref={codeRef}><pre className="code-block"><code>{sourceLines.map((line, index) => <button className={`code-line ${lineFocus === index + 1 ? "code-line-focused" : ""}`} key={index} data-line={index + 1} onClick={() => navigator.clipboard?.writeText(line).catch(() => undefined)} title="Click to copy this source line"><span className="line-number">{index + 1}</span><span className="line-content"><CodeText value={line || " "} /></span></button>)}</code></pre></div>
        <div className="source-bottom"><span><Check size={13} /> Exact source from this commit</span><span>{linesTruncated ? "Preview capped at 15,000 lines" : "Click a line to copy it"}</span></div>
      </> : <div className="source-empty"><div className="source-empty-art"><Code2 size={23} /></div><b>Pick a file to inspect</b><p>Use the tree or search for a file or symbol. Source is fetched on demand and capped at 128 KB per file.</p><div className="source-empty-chips"><span><Braces size={12} /> {analysis.scannedFiles} files sampled</span><span><LockKeyhole size={12} /> read-only</span></div></div>}
    </section>
      <aside className="file-insights"><section className="panel insight-panel"><PanelHeader title="File details" />{selected ? <><div className="file-detail-path"><span className="file-detail-icon"><FileCode2 size={16} /></span><div><b>{selected.path.split("/").at(-1)}</b><small>{selected.path}</small></div></div><div className="detail-kv"><span>Classification</span><b>{selected.importance}</b><span>Language</span><b>{selected.language}</b><span>Size</span><b>{formatBytes(selected.size)}</b><span>In scan sample</span><b>{selected.scanned ? "Yes" : "No"}</b></div>{!selected.scanned && <p className="muted-copy file-sample-note">Not used to build the overview. The source viewer loads it directly when you open it.</p>}<button className="explain-file-button" onClick={() => explainFile(selected.path)}><Sparkles size={13} /> Explain this file <ArrowUpRight size={12} /></button>{visibleSymbols.length > 0 && <div className="insight-subsection"><span className="subsection-label">SYMBOLS IN THIS FILE</span><div className="symbol-list">{visibleSymbols.map((symbol) => <button key={symbol} onClick={() => setSearch(symbol)}><Braces size={12} />{symbol}</button>)}</div></div>}</> : <p className="insight-placeholder">Select a file to see its classification, extracted symbols, and imports.</p>}</section>
      <section className="panel insight-panel"><PanelHeader title="Imports" />{visibleImports.length ? <div className="import-list">{visibleImports.slice(0, 10).map((specifier) => { const edge = analysis.edges.find((item) => item.from === selected?.path && item.specifier === specifier); return <button key={specifier} onClick={() => edge && openFile(edge.to)} disabled={!edge}><ArrowUpRight size={13} /><span>{specifier}</span>{edge && <Check size={12} />}</button>; })}</div> : <p className="insight-placeholder">{selected?.scanned || loadedSource ? "No supported import declarations were found in this file." : "This file was not in the overview sample. Use Explain this file for a focused source read."}</p>}</section>
      <section className="panel insight-panel"><PanelHeader title="Connected files" />{selected ? <div className="import-list">{analysis.edges.filter((edge) => edge.from === selected.path || edge.to === selected.path).slice(0, 8).map((edge, index) => { const related = edge.from === selected.path ? edge.to : edge.from; return <button key={`${related}-${index}`} onClick={() => openFile(related, edge.line)}><ArrowRight size={13} /><span>{related}</span><small>L{edge.line}</small></button>; })}{!analysis.edges.some((edge) => edge.from === selected.path || edge.to === selected.path) && <p className="insight-placeholder">{selected.scanned ? "No resolved local imports connect this file in the sample." : "Connections for this file were not part of the overview sample."}</p>}</div> : <p className="insight-placeholder">Connected files appear when a sampled import resolves.</p>}</section>
    </aside>
  </div>;
}

function ChatView({ analysis, messages, input, setInput, busy, error, ask, openFile, aiConfigured, clearConversation, level, setLevel }: {
  analysis: RepositoryAnalysis; messages: ChatMessage[]; input: string; setInput: (value: string) => void; busy: boolean; error: string; ask: (event?: FormEvent, suggested?: string) => void; openFile: (path: string, line?: number) => void; aiConfigured: boolean; clearConversation: () => void; level: ExplanationLevel; setLevel: (level: ExplanationLevel) => void;
}) {
  const suggestions = ["Where does this project start?", "How are the main modules connected?", "Where are tests located?", "Show files with TODO or FIXME notes"];
  return <div className="chat-layout"><section className="panel chat-panel"><div className="chat-topbar"><div className="chat-assistant-mark"><Sparkles size={16} /></div><div><b>RepoMind assistant</b><small>{aiConfigured ? "AI synthesis · source-grounded" : "Source search · AI provider not configured"}</small></div><span className="chat-commit"><GitCommitHorizontal size={13} />{analysis.repository.commit.slice(0, 7)}</span><label className="chat-level-select">{level === "beginner" ? "Beginner" : level === "advanced" ? "Advanced" : "Intermediate"}<ChevronDown size={12} /><select value={level} onChange={(event) => setLevel(event.target.value as ExplanationLevel)} aria-label="Explanation level"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><button className="chat-new-button" onClick={clearConversation} title="Start a new conversation"><Plus size={13} /> New</button><button className="chat-clear-button" onClick={clearConversation} title="Clear conversation" aria-label="Clear conversation"><X size={14} /></button></div>
    <div className="chat-messages">{!messages.length && <div className="chat-welcome"><div className="chat-welcome-icon"><MessageSquareText size={22} /></div><h2>Ask about this repository.</h2><p>Answers use the selected commit and show exact source references. Without an AI key, repository questions return matching excerpts and file explanations show a structural summary.</p><div className="suggested-questions">{suggestions.map((question) => <button key={question} onClick={() => ask(undefined, question)} disabled={busy}><span><Sparkles size={13} /></span>{question}<ArrowUpRight size={13} /></button>)}</div></div>}
      {messages.map((message, index) => <div className={`message-row message-${message.role}`} key={`${message.role}-${index}`}><div className={`message-avatar ${message.role === "assistant" ? "message-avatar-ai" : ""}`}>{message.role === "assistant" ? <Sparkles size={14} /> : <span>YOU</span>}</div><div className="message-body"><div className="message-label">{message.role === "assistant" ? "REPOMIND" : "YOU"}{message.mode && <span>{message.mode === "ai" ? "AI EXPLANATION" : message.mode === "file" ? "FILE SUMMARY" : "SOURCE SEARCH"}</span>}</div><p>{message.text}</p>{Boolean(message.citations?.length) && <div className="citation-list"><span>{message.mode === "file" ? "SELECTED FILE" : "REFERENCES"}</span>{message.citations?.map((citation, ci) => <button key={`${citation.path}-${citation.start}-${ci}`} onClick={() => openFile(citation.path, citation.start)}><FileCode2 size={13} /><span>{citation.path}</span><small>L{citation.start}{citation.end > citation.start ? `–${citation.end}` : ""}</small><ArrowUpRight size={12} /></button>)}</div>}</div></div>)}
      {busy && <div className="message-row message-assistant"><div className="message-avatar message-avatar-ai"><Sparkles size={14} /></div><div className="message-body"><div className="message-label">REPOMIND</div><div className="typing-indicator"><i /><i /><i /><span>Reading source evidence…</span></div></div></div>}
      {error && <div className="chat-error"><TriangleAlert size={14} />{error}<button onClick={() => setInput(input || "Can you try that question again?")}>Edit question</button></div>}
    </div><form className="chat-composer" onSubmit={(event) => ask(event)}><div className="composer-context"><span><LockKeyhole size={12} /> {analysis.repository.name}</span><i /> <span>commit {analysis.repository.commit.slice(0, 7)}</span></div><div className="composer-input-row"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Ask about a feature, function, or file…" rows={2} maxLength={1000} /><button className="send-button" type="submit" aria-label="Send question" disabled={!input.trim() || busy}><Send size={16} /></button></div><div className="composer-foot"><span>{aiConfigured ? <><Sparkles size={12} /> Source-backed AI answer</> : <><Search size={12} /> Exact source search mode</>}</span><span>Enter to send · Shift + Enter for new line</span></div></form>
  </section><aside className="chat-side"><section className="panel chat-context-panel"><PanelHeader title="Repository context" /><div className="context-repo"><span className="repo-avatar">{analysis.repository.name.charAt(0).toUpperCase()}</span><div><b>{analysis.repository.fullName}</b><small>At {analysis.repository.commit.slice(0, 7)}</small></div></div><div className="context-stats"><span><FileText size={14} />{analysis.totalFiles.toLocaleString()} files in tree</span><span><Code2 size={14} />{analysis.scannedFiles} files sampled</span><span><Network size={14} />{analysis.edges.length} import links</span></div><div className="context-note"><ShieldCheck size={14} /><p>Source citations are assembled server-side from files in the pinned commit.</p></div></section><section className="panel chat-quick-panel"><PanelHeader title="Try asking" /><div>{suggestions.map((question) => <button key={question} onClick={() => ask(undefined, question)} disabled={busy}><Sparkles size={13} />{question}<ArrowUpRight size={13} /></button>)}</div></section><section className="provider-note"><div className="provider-note-icon"><LockKeyhole size={14} /></div><div><b>{aiConfigured ? "Provider connected" : "Bring your own AI"}</b><p>{aiConfigured ? "The configured server-side model is used for explanations. Your key never enters the browser." : "Add AI_API_KEY on the server to enable synthesized explanations. Source search works without it."}</p><span>{aiConfigured ? "KEY STORED SERVER-SIDE" : "NO KEY REQUIRED FOR SEARCH"}</span></div></section></aside></div>;
}

function DocumentationView({ analysis, kind, setKind, text, setText, busy, error, generate, aiConfigured }: {
  analysis: RepositoryAnalysis; kind: DocumentationKind; setKind: (kind: DocumentationKind) => void; text: string; setText: (text: string) => void; busy: boolean; error: string; generate: (kind?: DocumentationKind, enhanceWithAi?: boolean) => void; aiConfigured: boolean;
}) {
  const options: [DocumentationKind, string][] = [["readme", "README"], ["architecture", "Architecture"], ["api", "API"], ["database", "Database"], ["setup", "Setup"], ["onboarding", "Onboarding"], ["module", "Modules"], ["environment", "Environment"]];
  const download = (extension: "md" | "txt") => {
    const blob = new Blob([text], { type: extension === "md" ? "text/markdown" : "text/plain" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href; link.download = `${kind}.md`; link.click(); URL.revokeObjectURL(href);
  };
  return <div className="tool-content"><section className="panel tool-controls"><div><b>Documentation generator</b><span>Evidence is generated from {analysis.repository.commit.slice(0, 7)} and remains editable before export.</span></div><div className="tool-control-row"><select value={kind} onChange={(event) => setKind(event.target.value as DocumentationKind)}>{options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="primary-button" onClick={() => generate()} disabled={busy}>{busy ? "Generating…" : "Generate draft"}</button><button className="outline-button" onClick={() => generate(kind, true)} disabled={busy || !aiConfigured}><Sparkles size={14} /> AI enhance</button><button className="outline-button" onClick={() => download("md")} disabled={!text}>Download Markdown</button></div>{error && <div className="notice notice-warn"><TriangleAlert size={15} />{error}</div>}</section><div className="tool-grid"><section className="panel tool-editor"><PanelHeader title="Editable Markdown" /><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Choose a document type and generate a draft." /></section><section className="panel tool-preview"><PanelHeader title="Preview" /><pre>{text || "Your generated document will appear here."}</pre></section></div></div>;
}

function PullRequestView({ number, setNumber, report, busy, error, analyze }: {
  number: string; setNumber: (value: string) => void; report: PullReport | null; busy: boolean; error: string; analyze: (event?: FormEvent) => void;
}) {
  return <div className="tool-content"><section className="panel tool-controls"><form onSubmit={analyze}><div><b>Read-only pull request review</b><span>GitHub metadata and patches are inspected. RepoMind never approves, merges, or publishes comments.</span></div><div className="tool-control-row"><input value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Pull request number" /><button className="primary-button" disabled={busy || !number}>{busy ? "Analyzing…" : "Analyze PR"}</button></div></form>{error && <div className="notice notice-warn"><TriangleAlert size={15} />{error}</div>}</section>{report && <><div className="dependency-overview"><StatCard label="CHANGED FILES" value={report.pull.changed_files} note={`+${report.pull.additions} / -${report.pull.deletions}`} icon={<GitFork size={16} />} /><StatCard label="FINDINGS" value={report.findings.length} note={report.mode === "ai" ? "AI-assisted, patch-grounded" : "Deterministic patch checks"} icon={<ShieldCheck size={16} />} /><StatCard label="BRANCHES" value={`${report.pull.head.ref} → ${report.pull.base.ref}`} note={`PR #${report.pull.number}`} icon={<GitBranch size={16} />} /></div><section className="panel report-panel"><PanelHeader title={report.pull.title} /><p className="report-summary">{report.summary}</p>{report.findings.map((finding, index) => <article className="finding-row" key={`${finding.file}-${index}`}><span className={`finding-severity severity-${finding.severity}`}>{finding.severity}</span><div><b>{finding.file}{finding.line ? `:${finding.line}` : ""}</b><p>{finding.explanation}</p><small>Impact: {finding.impact} · Fix: {finding.fix} · Confidence: {finding.confidence}/10</small></div></article>)}{!report.findings.length && <div className="empty-inline">No findings were produced from the available metadata and patches. This is not a guarantee that the change is defect-free.</div>}<div className="report-files">{report.files.map((file) => <span key={file.filename}><FileCode2 size={12} />{file.status} · {file.filename}</span>)}</div></section></>}</div>;
}

function ComparisonView({ analysis, url, setUrl, report, busy, error, compare }: {
  analysis: RepositoryAnalysis; url: string; setUrl: (value: string) => void; report: ComparisonReport | null; busy: boolean; error: string; compare: (event?: FormEvent) => void;
}) {
  const metrics = report ? [["Files", report.first.files, report.second.files], ["Sampled files", report.first.sampledFiles, report.second.sampledFiles], ["Import edges", report.first.importEdges, report.second.importEdges], ["Test files", report.first.testFiles, report.second.testFiles], ["Documentation", report.first.documentation ? "Yes" : "No", report.second.documentation ? "Yes" : "No"]] : [];
  return <div className="tool-content"><section className="panel tool-controls"><form onSubmit={compare}><div><b>Compare repository snapshots</b><span>{analysis.repository.fullName} is the first repository. Both sides use bounded, read-only analysis.</span></div><div className="tool-control-row"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/other-repository" /><button className="primary-button" disabled={busy || !url.trim()}>{busy ? "Comparing…" : "Compare"}</button></div></form>{error && <div className="notice notice-warn"><TriangleAlert size={15} />{error}</div>}</section>{report && <section className="panel comparison-panel"><div className="comparison-head"><div><b>{report.first.repository.fullName}</b><small>{report.first.repository.commit.slice(0, 7)}</small></div><span>vs</span><div><b>{report.second.repository.fullName}</b><small>{report.second.repository.commit.slice(0, 7)}</small></div></div><div className="comparison-table">{metrics.map(([label, first, second]) => <div key={label as string}><span>{label}</span><b>{String(first)}</b><b>{String(second)}</b></div>)}</div><div className="comparison-columns"><div><h3>Technology</h3><p>{report.first.languages.map((item) => item.name).join(", ") || "No language data"}</p><p>{report.first.frameworks.join(", ") || "No framework signals"}</p></div><div><h3>Technology</h3><p>{report.second.languages.map((item) => item.name).join(", ") || "No language data"}</p><p>{report.second.frameworks.join(", ") || "No framework signals"}</p></div></div><p className="muted-copy">These indicators describe detected evidence and are not a universal quality score. Choose based on your requirements and inspect the cited repository files.</p></section>}</div>;
}

function DependenciesView({ analysis, openFile }: { analysis: RepositoryAnalysis; openFile: (path: string, line?: number) => void }) {
  const directImports = analysis.edges.filter((edge) => edge.from && edge.to);
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of directImports) { outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1); incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1); }
  const impactTarget = analysis.files.filter((file) => (incoming.get(file.path) || 0) > 0).sort((a, b) => (incoming.get(b.path) || 0) - (incoming.get(a.path) || 0)).slice(0, 8);
  return <div className="dependencies-content"><div className="dependency-overview"><StatCard label="DECLARED DEPENDENCIES" value={analysis.dependencies.length} note={`From ${analysis.summary.packageManifests?.filter((manifest) => manifest.scanned).length || 0} scanned manifests`} icon={<Boxes size={16} />} /><StatCard label="RESOLVED IMPORTS" value={directImports.length} note="Source-level local relationships" icon={<Network size={16} />} accent="accent-mint" /><StatCard label="MOST IMPORTED" value={impactTarget[0]?.path.split("/").at(-1) || "—"} note={impactTarget[0] ? `${incoming.get(impactTarget[0].path)} incoming links` : "No high-connectivity file found"} icon={<ArrowDownRight size={16} />} /></div>
    <div className="dependency-grid"><section className="panel dependency-packages"><PanelHeader title="Declared packages" /><div className="dependency-table-head"><span>PACKAGE · MANIFEST</span><span>VERSION</span><span>GROUP</span></div>{analysis.dependencies.slice(0, 80).map((dependency) => <div className="dependency-row" key={`${dependency.manifestPath || ""}-${dependency.group}-${dependency.name}`}><span className="package-symbol" title={dependency.manifestPath}><Boxes size={13} /><span className="package-label"><b>{dependency.name}</b><small>{dependency.manifestPath || "Manifest path unavailable"}</small></span></span><code>{dependency.version}</code><span className={`dependency-group ${dependency.group}`}>{dependency.group}</span></div>)}{!analysis.dependencies.length && <EmptyState icon={<Boxes size={18} />} title="No dependency manifest parsed" body="Supported manifests include Node.js, Python, Go, Rust, Java, PHP, and Ruby." />}{analysis.dependencies.length > 80 && <div className="table-foot">Showing 80 of {analysis.dependencies.length} declared packages.</div>}</section>
      <aside className="dependency-right"><section className="panel"><PanelHeader title="File imports" /><div className="file-import-list">{impactTarget.map((file) => <div className="file-import-row" key={file.path}><button className="file-import-name" onClick={() => openFile(file.path)}><FileCode2 size={14} /><span>{file.path}</span><ArrowUpRight size={12} /></button><div className="import-counts"><span title="Incoming importers"><ArrowDownRight size={12} /> {incoming.get(file.path) || 0}</span><span title="Outgoing imports"><ArrowUpRight size={12} /> {outgoing.get(file.path) || 0}</span></div></div>)}{!impactTarget.length && <div className="empty-inline">The bounded source sample did not resolve any local import edges.</div>}</div></section><section className="panel impact-panel"><span className="impact-icon"><TriangleAlert size={15} /></span><b>Impact analysis scope</b><p>Incoming counts show sampled files that import this file. A potential impact list is limited to static import edges; it cannot determine runtime effects or external consumers.</p><span className="verified-label"><Check size={12} /> Relationships verified against repository paths</span></section></aside></div>
    <section className="panel import-edge-panel"><PanelHeader title="Resolved local import statements" /><div className="edge-table-head"><span>IMPORTER</span><span>STATEMENT</span><span>RESOLVES TO</span><span>LINE</span></div>{directImports.slice(0, 36).map((edge, index) => <button className="edge-row" key={`${edge.from}-${edge.to}-${index}`} onClick={() => openFile(edge.from, edge.line)}><span><FileCode2 size={13} />{edge.from}</span><code>{edge.specifier}</code><span><ArrowRight size={12} /> {edge.to}</span><small>{edge.line}</small></button>)}{!directImports.length && <div className="empty-inline">No local import statements were resolved in the sampled files.</div>}</section>
  </div>;
}

function HistoryView({ analysis, commits, frequentFiles, busy, error, onRetry }: { analysis: RepositoryAnalysis; commits: RepoCommit[] | null; frequentFiles: { path: string; changes: number }[]; busy: boolean; error: string; onRetry: () => void }) {
  if (busy) return <LoadingState message="Reading public commit history from GitHub…" />;
  if (error) return <ErrorPanel title="History could not be loaded" message={error} onRetry={onRetry} />;
  if (!commits) return null;
  return <div className="history-content"><div className="history-summary-row"><StatCard label="RECENT COMMITS" value={commits.length} note="Latest commits returned by GitHub" icon={<GitCommitHorizontal size={16} />} /><StatCard label="CONTRIBUTORS" value={new Set(commits.map((commit) => commit.author)).size} note="Authors in this commit window" icon={<GithubMark size={16} />} /><StatCard label="FILES TOUCHED" value={frequentFiles.length} note="Unique files in sampled commit details" icon={<FileCode2 size={16} />} /></div><div className="history-grid"><section className="panel commit-panel"><PanelHeader title="Recent commits" /><div className="commit-timeline">{commits.map((commit) => <article className="commit-item" key={commit.sha}><span className="timeline-mark"><GitCommitHorizontal size={13} /></span><div className="commit-main"><div className="commit-title-line"><a href={`${analysis.repository.url}/commit/${commit.sha}`} target="_blank" rel="noreferrer">{commit.message || "(no commit message)"}<ExternalLink size={12} /></a><code>{commit.shortSha}</code></div><div className="commit-meta"><span><GithubMark size={12} /> {commit.author}</span><span><Clock3 size={12} /> {commit.date ? timeAgo(commit.date) : "Date unavailable"}</span></div>{commit.files.length > 0 && <div className="commit-file-chips">{commit.files.slice(0, 4).map((file) => <span key={file}><FileCode2 size={11} />{file}</span>)}{commit.files.length > 4 && <small>+{commit.files.length - 4} more</small>}</div>}</div></article>)}{!commits.length && <EmptyState icon={<GitCommitHorizontal size={18} />} title="No public commits returned" body="GitHub did not return commit history for this repository." />}</div><div className="history-note"><ShieldCheck size={13} /> Commit messages are author-provided context, not proof of intent. File lists come from GitHub commit metadata.</div></section><aside className="history-side"><section className="panel"><PanelHeader title="Frequently changed" /><p className="side-panel-copy">Most common paths in detailed information for the latest six commits.</p><div className="frequent-file-list">{frequentFiles.map((file, index) => <div key={file.path}><span className="freq-rank">{String(index + 1).padStart(2, "0")}</span><span className="freq-path"><FileCode2 size={13} />{file.path}</span><b>{file.changes}</b></div>)}{!frequentFiles.length && <div className="empty-inline">No changed-file details were available in the recent commit sample.</div>}</div><div className="frequent-foot">Recent sample only · not lifetime repository statistics</div></section><section className="panel history-scope"><span><Activity size={15} /></span><b>What is measured</b><p>The timeline uses up to 12 recent public commits. Changed-file frequencies use detailed data from up to six commits.</p></section></aside></div></div>;
}

function GettingStartedView({ analysis, openFile }: { analysis: RepositoryAnalysis; openFile: (path: string, line?: number) => void }) {
  const tasks = analysis.findings.slice(0, 30);
  const manifests = analysis.summary.packageManifests || [];
  const testScript = analysis.summary.packageScripts.some((script) => script.name === "test");
  return <div className="contribution-content"><div className="contribution-hero"><div><span className="contribution-kicker"><Compass size={14} /> PROJECT SETUP</span><h2>Find a grounded<br /><span>place to begin.</span></h2><p>Commands and signals come from the repository’s actual manifests, files, and metadata.</p></div><div className="readiness-ring"><div><strong>{analysis.summary.hasLicense ? "✓" : "—"}</strong><span>{analysis.summary.hasLicense ? "license found" : "no license"}</span></div></div></div>
    <div className="contribution-grid"><section className="panel contribution-setup"><PanelHeader title="Getting the project running" /><p className="setup-intro">Each command is tied to its own package manifest and working directory.</p><div className="setup-command-list">{manifests.length ? manifests.slice(0, 10).map((manifest) => { const directory = manifest.workingDirectory; const lockNames = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "package-lock.json"]; const lockPresent = analysis.files.some((file) => file.path === (directory === "." ? "" : `${directory}/`) + "package-lock.json" || lockNames.some((name) => file.path === `${directory === "." ? "" : `${directory}/`}${name}`)); const hasTestScript = manifest.scripts.some((script) => script.name === "test"); const hasRunScript = manifest.scripts.some((script) => script.name === "dev" || script.name === "start"); return <div className="manifest-setup" key={manifest.path}><div className="manifest-setup-heading"><b>{manifest.ecosystem}</b><code>{manifest.path}</code><small>Run from {directory}</small></div>{manifest.scanned ? <><SetupCommand label="Install" command={manifest.installCommand || "No install command inferred"} evidence={manifest.ecosystem === "Node.js" && lockPresent ? "Lockfile found beside this manifest" : manifest.path.endsWith("requirements.txt") ? "Requirements file found" : "Conventional command for this manifest"} inferred={manifest.ecosystem !== "Node.js" && !manifest.path.endsWith("requirements.txt")} />{manifest.runCommand && <SetupCommand label="Run" command={manifest.runCommand} evidence={hasRunScript ? "Declared in this package's scripts" : "Detected from project entry files"} inferred={!hasRunScript} />}<SetupCommand label="Test" command={manifest.testCommand || "No test command detected"} evidence={hasTestScript ? "Declared in this package's scripts" : manifest.testCommand ? "Suggested from manifest and sampled dependencies" : "No supported test command was detected"} inferred={!hasTestScript && Boolean(manifest.testCommand)} /></> : <button className="doc-link-row" onClick={() => openFile(manifest.path)}><FileCode2 size={14} /><span><b>Manifest was not sampled</b><small>Open {manifest.path}</small></span><ArrowUpRight size={14} /></button>}</div>; }) : <div className="empty-inline">No supported package manifest was found. {analysis.summary.readmePath ? <>Read <button className="inline-link" onClick={() => openFile(analysis.summary.readmePath!)}>{analysis.summary.readmePath}</button> for project-specific setup steps.</> : "Check project documentation before choosing setup commands."}</div>}</div>{analysis.summary.readmePath && <button className="doc-link-row" onClick={() => openFile(analysis.summary.readmePath!)}><BookOpen size={14} /><span><b>Project documentation</b><small>{analysis.summary.readmePath}</small></span><ArrowUpRight size={14} /></button>}</section>
       <section className="panel contribution-checks"><PanelHeader title="Project signals" /><SignalRow label="README" value={analysis.summary.readmePath || "Not found"} good={Boolean(analysis.summary.readmePath)} /><SignalRow label="License" value={analysis.summary.hasLicense ? analysis.repository.license || "File found" : "Not found"} good={analysis.summary.hasLicense} /><SignalRow label="Test files" value={analysis.summary.testFiles.length ? `${analysis.summary.testFiles.length} paths found` : "None detected"} good={analysis.summary.testFiles.length > 0} /><SignalRow label="Test command" value={testScript ? "Declared in package scripts" : analysis.summary.testCommand ? "Suggested from manifest" : "Not detected"} good={Boolean(analysis.summary.packageManifests.some((manifest) => manifest.testCommand))} /><SignalRow label="Setup docs" value={analysis.summary.readmePath ? "README available" : "Not detected"} good={Boolean(analysis.summary.readmePath)} /><div className="contribution-scope"><ShieldCheck size={14} /><span>“Not detected” means the bounded scanner found no supported signal. It does not prove the project lacks one.</span></div></section>
      <section className="panel todo-panel"><PanelHeader title="In-code contribution notes" action={tasks.length > 0 ? `${analysis.findings.length} found` : undefined} /><p className="todo-intro">TODO, FIXME, and HACK markers from sampled source files only. RepoMind does not invent GitHub issues.</p>{tasks.map((finding, index) => <button className="todo-row" key={`${finding.path}-${finding.line}-${index}`} onClick={() => openFile(finding.path, finding.line)}><span className={`todo-kind todo-${finding.kind.toLowerCase()}`}>{finding.kind}</span><span className="todo-message">{finding.text}</span><span className="todo-location">{finding.path}:{finding.line}</span><ArrowUpRight size={13} /></button>)}{!tasks.length && <EmptyState icon={<Check size={18} />} title="No markers in scanned files" body="The bounded source sample contained no TODO, FIXME, or HACK markers. Search the repository for a broader check." />}</section>
      <section className="panel contribution-next"><span className="next-step-icon"><ArrowRight size={16} /></span><b>Potential first steps</b><p>Understand a top-level folder, follow one import link, or review an in-code note above. Check the maintainer’s contributing guide before opening a pull request.</p><div className="next-step-links">{analysis.summary.directories.slice(0, 4).map((directory) => <span key={directory.name}><FolderClosed size={12} />{directory.name}/ <small>{directory.count} files</small></span>)}</div></section></div>
  </div>;
}

function SetupCommand({ label, command, evidence, inferred }: { label: string; command: string; evidence: string; inferred: boolean }) {
  const [copied, setCopied] = useState(false);
  return <div className="setup-command"><div className="setup-command-heading"><b>{label}</b><span className={inferred ? "inferred-pill" : "verified-pill"}>{inferred ? "NOT VERIFIED" : "FROM MANIFEST"}</span></div><div className="command-snippet"><code>{command}</code><button onClick={() => { navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => undefined); }} title="Copy command">{copied ? <Check size={14} /> : <Command size={14} />}</button></div><small>{evidence}</small></div>;
}

function SignalRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="signal-row"><span className={`signal-indicator ${good ? "signal-good" : "signal-missing"}`}>{good ? <Check size={11} /> : <span>–</span>}</span><b>{label}</b><small>{value}</small></div>;
}

function CommandPalette({ onClose, onChoose }: { onClose: () => void; onChoose: (view: View) => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = VIEWS.filter((view) => view.label.toLowerCase().includes(query.toLowerCase()));
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && filtered.length) { event.preventDefault(); setActiveIndex((index) => (index + 1) % filtered.length); }
    if (event.key === "ArrowUp" && filtered.length) { event.preventDefault(); setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length); }
    if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); onChoose(filtered[activeIndex].id); }
  };
  return <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="command-modal"><div className="command-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={handleKeyDown} placeholder="Search workspace…" /><kbd>ESC</kbd></div><div className="command-list"><span className="command-group-title">NAVIGATE</span>{filtered.map((view, index) => { const Icon = view.icon; return <button className={activeIndex === index ? "command-active" : ""} key={view.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => onChoose(view.id)}><Icon size={15} /><span>{view.label}</span><kbd>{index < 9 ? index + 1 : "↵"}</kbd></button>; })}{!filtered.length && <div className="command-empty">No matching workspace sections.</div>}</div><div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to open</span></div></div></div>;
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <div className="empty-state"><span>{icon}</span><b>{title}</b><p>{body}</p></div>;
}

function LoadingState({ message }: { message: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" size={19} /><span>{message}</span></div>;
}

function ErrorPanel({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return <div className="error-panel"><span><TriangleAlert size={19} /></span><h3>{title}</h3><p>{message}</p><button className="outline-button" onClick={onRetry}>Try again <ArrowRight size={14} /></button></div>;
}
