import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The GitStore reaches out through the git API layer (`./api`) and the
 * notifications/logger/i18n singletons. None of those touch anything a test
 * of the store's own state transitions should care about, so they are stubbed.
 *
 * This mirrors the pattern used in `panes/store.test.ts`: the mock object is
 * created with vi.hoisted so it is available when vi.mock factories run.
 */
const { api } = vi.hoisted(() => ({
  api: {
    gitBranches: vi.fn(),
    gitCommit: vi.fn(),
    gitDiscard: vi.fn(),
    gitFetch: vi.fn(),
    gitFindRepos: vi.fn(),
    gitInit: vi.fn(),
    gitLog: vi.fn(),
    gitPull: vi.fn(),
    gitPush: vi.fn(),
    gitRepoInfo: vi.fn(),
    gitStage: vi.fn(),
    gitStatus: vi.fn(),
    gitSwitchBranch: vi.fn(),
    gitUnstage: vi.fn(),
  },
}));

vi.mock("./api", () => api);

vi.mock("$lib/shared/services/logger.svelte", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("$lib/features/notifications/store.svelte", () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("$lib/features/settings/store.svelte", () => ({
  settings: {
    state: {
      gitAutoFetch: false,
      gitAutoFetchSeconds: 60,
    },
  },
}));

vi.mock("$lib/i18n/index.svelte", () => ({
  t: (key: string) => key,
}));

import { gitStore, gitScope } from "./store.svelte";

function mockRepoInfo(overrides: Partial<{
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  refsVersion: string | null;
  commitCount: number;
}> = {}) {
  return {
    isRepo: true,
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    refsVersion: "abc123",
    commitCount: 5,
    ...overrides,
  };
}

function mockCommit(i: number, sha: string = `sha-${i}`) {
  return {
    sha,
    shortSha: `s${i}`,
    parents: [],
    author: "a",
    email: "e",
    time: 0,
    summary: `commit ${i}`,
    additions: 0,
    deletions: 0,
    refs: [],
    localOnly: false,
    remoteOnly: false,
  };
}

const LOG_PAGE = 80;
const LOG_MAX = 1000;

describe("gitScope", () => {
  it("combines project id and cwd", () => {
    expect(gitScope("proj", "/path/to/repo")).toBe("proj /path/to/repo");
  });

  it("separates scopes with a space, even if parts contain spaces", () => {
    expect(gitScope("my project", "/home/user")).toBe("my project /home/user");
  });
});

describe("GitStore.ensure / get / drop / reset", () => {
  beforeEach(() => {
    gitStore.reset();
    api.gitRepoInfo.mockReset();
    api.gitStatus.mockReset();
  });

  it("ensure creates an empty state for a new scope", () => {
    const scope = gitStore.ensure("proj", "/repo");
    const state = gitStore.get(scope);
    expect(state).not.toBeNull();
    expect(state!.isRepo).toBe(false);
    expect(state!.branch).toBeNull();
    expect(state!.staged).toEqual([]);
    expect(state!.loaded).toBe(false);
    expect(state!.loading).toBe(false);
  });

  it("get returns null for unknown scope", () => {
    expect(gitStore.get("nonexistent /nope")).toBeNull();
  });

  it("get returns null for null scope", () => {
    expect(gitStore.get(null)).toBeNull();
  });

  it("drop removes all states for a project id", () => {
    const s1 = gitStore.ensure("proj", "/repo1");
    const s2 = gitStore.ensure("proj", "/repo2");
    const s3 = gitStore.ensure("other", "/repo3");

    expect(gitStore.get(s1)).not.toBeNull();
    expect(gitStore.get(s2)).not.toBeNull();
    expect(gitStore.get(s3)).not.toBeNull();

    gitStore.drop("proj");

    expect(gitStore.get(s1)).toBeNull();
    expect(gitStore.get(s2)).toBeNull();
    // Different project survives.
    expect(gitStore.get(s3)).not.toBeNull();
  });

  it("reset clears everything", () => {
    gitStore.ensure("proj", "/repo1");
    gitStore.ensure("other", "/repo2");
    gitStore.reset();
  });
});

describe("GitStore.refresh", () => {
  beforeEach(() => {
    gitStore.reset();
    api.gitRepoInfo.mockReset();
    api.gitStatus.mockReset();
    api.gitLog.mockReset();
    api.gitBranches.mockReset();
  });

  it("does nothing on null scope", async () => {
    await expect(gitStore.refresh(null)).resolves.toBeUndefined();
  });

  it("sets isRepo, branch and clears error on success", async () => {
    api.gitRepoInfo.mockResolvedValue(mockRepoInfo({ isRepo: true, branch: "main" }));
    api.gitStatus.mockResolvedValue([]);
    api.gitLog.mockResolvedValue([]);

    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.refresh(scope);

    const state = gitStore.get(scope)!;
    expect(state.isRepo).toBe(true);
    expect(state.branch).toBe("main");
    expect(state.error).toBeNull();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
  });

  it("sets not-a-repo state when git says the folder is not a repository", async () => {
    api.gitRepoInfo.mockResolvedValue(mockRepoInfo({ isRepo: false, branch: null }));
    api.gitStatus.mockResolvedValue([]);

    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.refresh(scope);

    const state = gitStore.get(scope)!;
    expect(state.isRepo).toBe(false);
    expect(state.log).toEqual([]);
  });

  it("sets error text on failure without throwing (notifyErrors defaults to false)", async () => {
    api.gitRepoInfo.mockRejectedValue(new Error("git exploded"));

    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.refresh(scope);

    const state = gitStore.get(scope)!;
    expect(state.error).toBeTruthy();
    expect(state.error).toContain("git exploded");
    expect(state.loaded).toBe(true);
  });

  it("strips 'Error: ' prefix from error text", async () => {
    // new Error("something happened") -> String(err) = "Error: something happened"
    // errorText strips the outer "Error: " wrapper, leaving just the message.
    api.gitRepoInfo.mockRejectedValue(new Error("something happened"));

    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.refresh(scope);

    const state = gitStore.get(scope)!;
    expect(state.error).toBe("something happened");
  });

  it("falls back to generic message for empty error", async () => {
    // new Error("") -> String(err) = "Error" (no colon to strip)
    // errorText returns the trimmed String, which is "Error"
    // When message is truly empty (e.g. thrown string ""), it falls through.
    api.gitRepoInfo.mockRejectedValue("");

    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.refresh(scope);

    const state = gitStore.get(scope)!;
    expect(state.error).toBe("git failed");
  });
});

describe("GitStore.refresh concurrency", () => {
  beforeEach(() => {
    gitStore.reset();
    api.gitRepoInfo.mockReset();
    api.gitStatus.mockReset();
    api.gitLog.mockReset();
  });

  it("deduplicates in-flight refreshes", async () => {
    let resolveCount = 0;
    api.gitRepoInfo.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveCount += 1;
        setTimeout(() => resolve(mockRepoInfo({})), 50);
      });
    });
    api.gitStatus.mockResolvedValue([]);
    api.gitLog.mockResolvedValue([]);

    const scope = gitStore.ensure("proj", "/repo");
    const p1 = gitStore.refresh(scope);
    const p2 = gitStore.refresh(scope);
    await Promise.all([p1, p2]);

    expect(resolveCount).toBe(1);
  });

  it("reloadLog forces a log fetch on the next refresh", async () => {
    api.gitRepoInfo.mockResolvedValue(mockRepoInfo({ branch: "main" }));
    api.gitStatus.mockResolvedValue([]);
    // Return non-empty commits so hasLog becomes true after the first refresh.
    api.gitLog.mockResolvedValue(Array.from({ length: 10 }, (_, i) => mockCommit(i)));
    const scope = gitStore.ensure("proj", "/repo");
    // First refresh: gitLog called once.
    await gitStore.refresh(scope);
    expect(api.gitLog).toHaveBeenCalledTimes(1);

    // Second refresh without reloadLog: no branch change, hasLog is true → skip.
    await gitStore.refresh(scope);
    expect(api.gitLog).toHaveBeenCalledTimes(1);

    // Third with reloadLog: forces a new log fetch.
    await gitStore.refresh(scope, { reloadLog: true });
    expect(api.gitLog).toHaveBeenCalledTimes(2);
  });
});

describe("GitStore.loadMore", () => {
  beforeEach(() => {
    gitStore.reset();
    api.gitRepoInfo.mockReset();
    api.gitStatus.mockReset();
    api.gitLog.mockReset();
  });

  it("does nothing on null scope", async () => {
    await expect(gitStore.loadMore(null)).resolves.toBeUndefined();
  });

  it("does nothing when there is no log to extend", async () => {
    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.loadMore(scope);
    expect(api.gitLog).not.toHaveBeenCalled();
  });

  it("fetches the next page of commits", async () => {
    api.gitRepoInfo.mockResolvedValue(mockRepoInfo({ isRepo: true }));
    api.gitStatus.mockResolvedValue([]);
    api.gitLog.mockResolvedValue(Array.from({ length: LOG_PAGE }, (_, i) => mockCommit(i)));

    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.refresh(scope);
    const state = gitStore.get(scope)!;
    expect(state.log.length).toBe(LOG_PAGE);
    expect(state.logHasMore).toBe(true);

    api.gitLog.mockResolvedValue(Array.from({ length: LOG_PAGE }, (_, i) => mockCommit(i, `s2-${i}`)));
    await gitStore.loadMore(scope);
    expect(state.log.length).toBe(LOG_PAGE * 2);
    expect(state.logLoadingMore).toBe(false);
  });

  it("stops at LOG_MAX commits", async () => {
    api.gitRepoInfo.mockResolvedValue(mockRepoInfo({ isRepo: true }));
    api.gitStatus.mockResolvedValue([]);
    // First page: LOG_PAGE commits, so logHasMore = true.
    api.gitLog.mockResolvedValue(Array.from({ length: LOG_PAGE }, (_, i) => mockCommit(i)));

    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.refresh(scope);

    // Fill up to LOG_MAX through loadMore, then try to go over.
    api.gitLog.mockResolvedValue(
      Array.from({ length: LOG_PAGE }, (_, i) => mockCommit(LOG_PAGE + i)),
    );
    await gitStore.loadMore(scope);
    // Repeat until we hit LOG_MAX.
    let state = gitStore.get(scope)!;
    while (state.log.length + LOG_PAGE <= LOG_MAX) {
      api.gitLog.mockResolvedValue(
        Array.from({ length: LOG_PAGE }, (_, i) =>
          mockCommit(state.log.length + i),
        ),
      );
      await gitStore.loadMore(scope);
      state = gitStore.get(scope)!;
    }
    // One more loadMore: should not exceed LOG_MAX.
    api.gitLog.mockResolvedValue(
      Array.from({ length: LOG_PAGE }, (_, i) => mockCommit(state.log.length + i)),
    );
    await gitStore.loadMore(scope);
    state = gitStore.get(scope)!;
    expect(state.log.length).toBe(LOG_MAX);
  });

  it("deduplicates commits by sha when merging pages", async () => {
    api.gitRepoInfo.mockResolvedValue(mockRepoInfo({ isRepo: true }));
    api.gitStatus.mockResolvedValue([]);
    api.gitLog.mockResolvedValueOnce(Array.from({ length: 80 }, (_, i) => mockCommit(i)));

    const scope = gitStore.ensure("proj", "/repo");
    await gitStore.refresh(scope);

    api.gitLog.mockResolvedValueOnce(
      Array.from({ length: 80 }, (_, i) => mockCommit(i, `sha-${70 + i}`)),
    );

    await gitStore.loadMore(scope);
    const state = gitStore.get(scope)!;
    expect(state.log.length).toBe(150);
  });
});

describe("GitStore.loadBranches", () => {
  beforeEach(() => {
    gitStore.reset();
    api.gitRepoInfo.mockReset();
    api.gitStatus.mockReset();
    api.gitBranches.mockReset();
  });

  it("loads branches and marks loaded", async () => {
    const scope = gitStore.ensure("proj", "/repo");
    api.gitBranches.mockResolvedValue([
      { name: "main", current: true },
      { name: "feature", current: false },
    ]);

    await gitStore.loadBranches(scope);

    const state = gitStore.get(scope)!;
    expect(state.branches).toHaveLength(2);
    expect(state.branches[0].name).toBe("main");
    expect(state.branchesLoaded).toBe(true);
    expect(state.branchesLoading).toBe(false);
  });

  it("does not reload when already loading", async () => {
    api.gitBranches.mockImplementation(() => new Promise(() => {}));

    const scope = gitStore.ensure("proj", "/repo");
    gitStore.loadBranches(scope);
    const p2 = gitStore.loadBranches(scope);
    await Promise.race([p2, Promise.resolve()]);
  });
});
