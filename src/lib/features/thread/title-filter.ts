// OSC title strings the AI CLIs emit by default. They overwrite the
// user-visible thread label ("Claude #1", "Backend codex", etc.) with a
// generic brand name, which makes the sidebar useless. Skip these so the
// label survives.
const GENERIC_TITLES = new Set([
  // A launcher, and one that names itself before it knows what it launched: the
  // Windows PTY titles the thread with fastpick's own image path. Keeping it
  // would replace the agent's name with `…\.local\bin\fastpick.exe`.
  "fastpick",
  "claude",
  "claude code",
  "claude-code",
  "anthropic",
  "codex",
  "openai codex",
  "chatgpt",
  "opencode",
  "cursor",
  "cursor-agent",
  "cursor agent",
  "gemini",
  "google gemini",
  "antigravity",
  "agy",
  "google antigravity",
  "copilot",
  "github copilot",
  "gh copilot",
  "grok",
  "xai",
  "hermes",
  "hermes agent",
  "nous research",
  "pi",
  "pi coding agent",
  "muse",
  "muse code",
  "meta",
  "powershell",
  "powershell 7",
  "pwsh",
  "windows powershell",
  "bash",
  "zsh",
  "sh",
  "fish",
  "nu",
  "nushell",
  "cmd",
  "cmd.exe",
  "command prompt",
  "terminal",
]);

const GENERIC_COMMAND_TOOLS = new Set([
  "git",
  "cargo",
  "rustc",
  "bun",
  "bunx",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "node",
  "deno",
  "python",
  "python3",
  "py",
  "pip",
  "conda",
  "pytest",
  "make",
  "cmake",
  "ninja",
  "gcc",
  "g++",
  "clang",
  "clang++",
  "go",
  "dotnet",
  "docker",
  "docker-compose",
  "kubectl",
  "curl",
  "wget",
  "grep",
  "ripgrep",
  "rg",
  "cat",
  "find",
  "dir",
  "ls",
]);

// Shells often emit their full executable path as the initial OSC title
// (e.g. "C:\Program Files\PowerShell\7\pwsh.exe", "/usr/bin/bash") or a
// Windows-style "Administrator: C:\Windows\System32\cmd.exe". Normalize to
// the basename, strip a trailing .exe, and re-check against the brand set.
function normalizeShellPath(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  // Drop "Administrator: " or "User: " prefixes cmd.exe prepends.
  const colon = trimmed.indexOf(": ");
  const body = colon > 0 && colon < 32 ? trimmed.slice(colon + 2) : trimmed;
  // Take last path segment.
  const lastSlash = Math.max(body.lastIndexOf("\\"), body.lastIndexOf("/"));
  if (lastSlash < 0) return null;
  let base = body.slice(lastSlash + 1).trim();
  if (!base) return null;
  if (base.toLowerCase().endsWith(".exe")) base = base.slice(0, -4);
  return base.toLowerCase();
}

const TOOL_PROSE = new Set([
  "the",
  "a",
  "an",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "it",
  "this",
  "that",
  "my",
  "your",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "with",
  "from",
  "into",
  "about",
  "by",
]);

function isToolCommandTitle(direct: string, tool: string): boolean {
  if (direct === tool) return true;
  const prefix = `${tool} `;
  if (!direct.startsWith(prefix)) return false;
  const first = direct.slice(prefix.length).split(/\s+/, 1)[0] ?? "";
  return first.length > 0 && !TOOL_PROSE.has(first);
}

// Codex appends title-generation progress and the cwd to its conversation name.
// Only remove a directory suffix when it matches this thread's cwd.
export function cleanOscTitle(title: string, cwd?: string | null): string {
  let clean = title.trim();
  const name = cwd?.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();
  const separator = clean.lastIndexOf(" | ");
  if (name && separator >= 0 && clean.slice(separator + 3).toLowerCase() === name.toLowerCase()) {
    clean = clean.slice(0, separator).trim();
  }
  clean = clean.replace(/\s*[\u2801-\u28ff]+$/u, "").trim();
  const first = clean.search(/[\p{L}\p{N}]/u);
  return first >= 0 ? clean.slice(first).trim() : clean;
}

export function isGenericTitle(
  title: string | null | undefined,
  cwd?: string | null,
): boolean {
  if (!title) return false;
  if (/^<(?:image(?:\s|>)|\/image>|recommended_plugins(?:\s|>))/i.test(title.trim())) return true;
  const direct = cleanOscTitle(title, cwd).toLowerCase();
  const identity = direct.split(" | ", 1)[0].replace(/\s*[\u2801-\u28ff]+$/u, "").trim();
  if (/^renaming(?:\.{3}|\u2026)$/u.test(identity)) return true;
  if (!direct && title.trim()) return true;
  if (GENERIC_TITLES.has(direct)) return true;
  const base = normalizeShellPath(title);
  if (base && (GENERIC_TITLES.has(base) || GENERIC_COMMAND_TOOLS.has(base))) return true;
  for (const tool of GENERIC_COMMAND_TOOLS) {
    if (isToolCommandTitle(direct, tool)) return true;
  }
  // Codex's default terminal_title is spinner + project dir name, which would
  // rename every thread in a project after its folder.
  if (cwd) {
    const dir = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const name = dir.slice(dir.lastIndexOf("/") + 1).toLowerCase();
    if (name && direct === name) return true;
  }
  return false;
}
