import { describe, expect, it } from "vitest";
import { sessionTitleUpdate } from "./session-title";

describe("native session titles", () => {
  const hit = { id: "own", mtimeMs: 0, title: "please fix this", name: "Fix Codex thread names" };
  it("replaces a provisional prompt when the native name arrives", () => {
    expect(sessionTitleUpdate("own", "please fix this", hit, false)).toBe(hit.name);
  });
  it("tracks subsequent native renames", () => {
    expect(sessionTitleUpdate("own", "Old generated name", hit, false)).toBe(hit.name);
  });
  it("preserves manual names and rejects another session", () => {
    expect(sessionTitleUpdate("own", "My title", hit, true)).toBeNull();
    expect(sessionTitleUpdate("other", null, hit, false)).toBeNull();
  });
  it("does not replace a title with the prompt or rewrite an unchanged name", () => {
    expect(sessionTitleUpdate("own", hit.name, hit, false)).toBeNull();
    expect(sessionTitleUpdate("own", "Existing", { ...hit, name: null }, false)).toBeNull();
  });
});
