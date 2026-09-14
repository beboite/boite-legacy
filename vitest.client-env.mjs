// Node globals, but Vite serves modules through its client environment, so
// Svelte resolves to its client runtime and runes compile with effects that run.
// Used by the `runes` project in vitest.config.ts.
export default {
  name: "svelte-client",
  viteEnvironment: "client",
  setup() {
    return { teardown() {} };
  },
};
