import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import type { Thread } from "$lib/types";

/**
 * The indexes are deriveds over `app.threads`, and they have to follow it.
 *
 * What broke them: Svelte re-runs a derived read inside an effect teardown
 * against the values from before the flush, and that re-run rewrites what the
 * derived depends on. A pane unmounting after `removeThread` (Terminal's
 * `onDestroy` asks `app.threadById`) left `#threadById` subscribed to the array
 * the close had just replaced, so a push onto the live one never reached it.
 */

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("$lib/storage/db", () => ({
  saveThread: async () => {},
  updateThreadTitle: async () => {},
  markThreadStarted: async () => {},
  setThreadSettled: async () => {},
  deleteThread: async () => {},
}));
vi.mock("$lib/shared/services/logger.svelte", () => ({
  logger: { warn, error: vi.fn(), info: vi.fn() },
}));
vi.mock("$lib/shared/log", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("$lib/features/settings/store.svelte", () => ({
  settings: {
    state: { smartSortBy: "manual", smartSortDirection: "desc", threadOrderByProject: {}, projectOrder: [] },
  },
}));
vi.mock("$lib/features/settings/device.svelte", () => ({ device: {} }));
vi.mock("$lib/features/settings/resolveLaunchView", () => ({ resolveLaunchView: () => "terminal" }));
vi.mock("$lib/i18n/index.svelte", () => ({ t: (key: string) => key }));
vi.mock("$lib/storage/platform.svelte", () => ({ platform: {} }));
vi.mock("$lib/features/notifications/store.svelte", () => ({
  notifications: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("$lib/backend", () => ({
  backend: () => ({}),
  workspace: { isDynamic: false, backendFor: () => ({ caps: { clientStatus: true } }) },
}));
vi.mock("$lib/features/thread/renamed", () => ({
  clearRenamed: () => {},
  isRenamed: () => false,
  markRenamed: () => {},
  pruneRenamed: () => {},
}));
vi.mock("$lib/features/thread/finished.svelte", () => ({
  noteStatusChange: () => {},
  resetFinished: () => {},
}));
vi.mock("$lib/features/thread/activity.svelte", () => ({ forgetThreadActivity: () => {} }));
vi.mock("$lib/features/thread/work-activity.svelte", () => ({
  forgetWorkStarted: () => {},
  noteProjectWork: () => {},
  projectWorkSince: () => null,
  workStartedSince: () => null,
}));
vi.mock("$lib/app/control-events", () => ({ applyControlEvent: () => {} }));
vi.mock("$lib/app/hydrate", () => ({
  loadRows: async () => ({ projects: [], threads: [] }),
  resyncFromServer: async () => {},
  syncRoots: async () => {},
}));
vi.mock("$lib/app/repair.svelte", () => ({
  deduplicateSessionIds: () => {},
  dropGenericTitles: () => {},
  migrateWorktrees: async () => {},
}));
vi.mock("$lib/app/projects.svelte", () => ({ ensureScratch: async () => null }));
vi.mock("$lib/app/boot-timing", () => ({
  bootTiming: { start() {}, mark() {}, report() {}, restart() {} },
}));

const { AppState } = await import("./store.svelte");

function row(id: string, over: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: "p",
    label: id,
    cmd: "sh",
    args: [],
    createdAt: 0,
    status: "idle",
    ...over,
  } as unknown as Thread;
}

/**
 * A close the way the window lives it: the row leaves the list, and the pane
 * that was drawing it reads the index from its teardown in the same flush.
 */
function closeWithPane(app: InstanceType<typeof AppState>, id: string) {
  let mounted = $state(true);
  const stop = $effect.root(() => {
    // Anything on screen that asks for a thread keeps the index connected, and
    // reads it before the pane goes.
    $effect(() => {
      void app.threadById("a");
    });
    $effect(() => {
      if (!mounted) return;
      return () => {
        void app.threadById(id);
      };
    });
  });
  flushSync();
  void app.removeThread(id);
  mounted = false;
  flushSync();
  return stop;
}

describe("the thread index after a close whose pane read it", () => {
  beforeEach(() => warn.mockClear());

  it("finds a thread created next without falling back to a scan", () => {
    const app = new AppState();
    app.threads = [row("a"), row("b")];
    const stop = closeWithPane(app, "b");

    void app.upsertThread(row("c"));

    expect(app.threadById("c")?.id).toBe("c");
    expect(warn).not.toHaveBeenCalled();
    stop();
  });

  it("hands back the row the list holds once it is replaced", () => {
    const app = new AppState();
    app.threads = [row("a"), row("b")];
    const stop = closeWithPane(app, "b");

    void app.upsertThread(row("a", { worktreePath: "/w" }));

    expect(app.threadById("a")).toBe(app.threads.find((t) => t.id === "a"));
    expect(app.threadById("a")?.worktreePath).toBe("/w");
    stop();
  });
});
