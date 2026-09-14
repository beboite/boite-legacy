import { describe, expect, it } from "vitest";
import { isGenericTitle, cleanOscTitle } from "./title-filter";

describe("cleanOscTitle", () => {
  it("keeps the Codex task name stable across title progress frames", () => {
    for (const frame of ["⠋", "⠙", "⠹", ""]) {
      expect(cleanOscTitle(`Fix login ${frame} | project`, "/work/project")).toBe("Fix login");
    }
  });

  it("preserves meaningful separators and other providers' titles", () => {
    expect(cleanOscTitle("API | Fix login ⠋ | project", "C:\\work\\project")).toBe("API | Fix login");
    expect(cleanOscTitle("API | design", "/work/project")).toBe("API | design");
    expect(cleanOscTitle("✻ Fix login")).toBe("Fix login");
  });
});

describe("isGenericTitle", () => {
  it("rejects Codex title-generation placeholders, including persisted titles", () => {
    for (const title of ["renaming... ⠋ | project", "renaming\u2026 ⠙ | project", "renaming...", "⠋ | project"]) {
      expect(isGenericTitle(title, "/work/project"), title).toBe(true);
    }
    expect(isGenericTitle("Renaming files safely | project", "/work/project")).toBe(false);
  });
  it("treats brand names as generic so the user's label survives", () => {
    for (const title of ["claude", "Claude Code", "  CODEX  ", "GitHub Copilot"]) {
      expect(isGenericTitle(title), title).toBe(true);
    }
  });

  it("keeps real work titles", () => {
    expect(isGenericTitle("Fixing the PTY read loop")).toBe(false);
    expect(isGenericTitle("src/lib/app/store.svelte.ts")).toBe(false);
  });

  it("is false for empty and missing titles", () => {
    expect(isGenericTitle(null)).toBe(false);
    expect(isGenericTitle(undefined)).toBe(false);
    expect(isGenericTitle("")).toBe(false);
  });

  it("normalizes a shell executable path down to its brand name", () => {
    expect(isGenericTitle("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(true);
    expect(isGenericTitle("/usr/bin/zsh")).toBe(true);
    expect(isGenericTitle("/bin/bash")).toBe(true);
  });

  it("treats fastpick's own image path as generic so the agent name survives", () => {
    expect(isGenericTitle("C:\\Users\\nuno\\.local\\bin\\fastpick.exe")).toBe(true);
    expect(isGenericTitle("fastpick")).toBe(true);
    expect(isGenericTitle("/home/nuno/.local/bin/fastpick")).toBe(true);
  });

  it("strips the elevation prefix cmd.exe prepends", () => {
    expect(isGenericTitle("Administrator: C:\\Windows\\System32\\cmd.exe")).toBe(true);
  });

  it("does not treat any executable path as generic", () => {
    expect(isGenericTitle("/usr/local/bin/boite")).toBe(false);
    expect(isGenericTitle("C:\\tools\\deploy.exe")).toBe(false);
  });

  it("treats the project folder name as generic, which is codex's default", () => {
    expect(isGenericTitle("boite", "D:\\Dev\\Collab\\boite")).toBe(true);
    expect(isGenericTitle("BOITE", "/home/nuno/boite")).toBe(true);
    expect(isGenericTitle("boite", "/home/nuno/boite/")).toBe(true);
  });

  it("does not treat a different folder name as generic", () => {
    expect(isGenericTitle("boite", "/home/nuno/other")).toBe(false);
    expect(isGenericTitle("anything", "")).toBe(false);
  });

  it("treats common tool and shell command executions as generic so thread names are not corrupted", () => {
    for (const title of [
      "git status",
      "git diff",
      "git log",
      "cargo test",
      "cargo build",
      "bun run check",
      "npm test",
      "python script.py",
      "pytest",
      "dir",
      "ls -la",
    ]) {
      expect(isGenericTitle(title), title).toBe(true);
    }
  });

  it("does not treat an English sentence that starts with a tool word as generic", () => {
    expect(isGenericTitle("find the bug")).toBe(false);
    expect(isGenericTitle("go to the store")).toBe(false);
    expect(isGenericTitle("make it work")).toBe(false);
    expect(isGenericTitle("find")).toBe(true);
    expect(isGenericTitle("go test")).toBe(true);
  });

  it("stays consistent with the Rust implementation for the shared cases", () => {
    // status.rs derives the same thing server-side; a title that is generic on
    // one side and not the other renames a thread only in remote mode.
    const shared: [string, string | null][] = [
      ["claude", null],
      ["pwsh", null],
      ["cmd.exe", null],
      ["boite", "/home/nuno/boite"],
      ["git status", null],
      ["cargo test", null],
      ["bun run check", null],
    ];
    for (const [title, cwd] of shared) {
      expect(isGenericTitle(title, cwd), title).toBe(true);
    }
  });
});
