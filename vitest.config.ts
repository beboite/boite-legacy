import { configDefaults, defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

// Standalone config on purpose: pulling in the SvelteKit plugin would drag the
// whole route/manifest pipeline into the test run. What is worth testing here
// is pure logic — parsers, matchers, redaction — so tests never need a DOM.
//
// The bare Svelte plugin is the exception, and it is not the same thing: it is
// here only to compile the runes out of `*.svelte.ts` modules, which is what
// the pane store is written in. Without it those files reach node with `$state`
// still spelled as a call to a function nobody defined.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // The store modules pull in Svelte's client runtime; the server build of it
    // has no `$state` proxy and would hand back plain objects that never react.
    conditions: ["browser"],
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "telemetry/src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "src/**/*.svelte.test.ts"],
          environment: "node",
        },
      },
      {
        // Under `node` a module is compiled for Svelte's server build, where
        // `$effect` never runs, so a test that needs an effect passes without
        // testing anything. Still node, still no DOM.
        extends: true,
        test: {
          name: "runes",
          include: ["src/**/*.svelte.test.ts"],
          environment: "./vitest.client-env.mjs",
        },
      },
    ],
  },
});
