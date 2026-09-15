import { expect, it } from "vitest";
import { DevApp } from "./lib/devApp";
import { settleWindow, stopApp } from "./lib/harness";

// Reboots an empty instance twice; opt in to keep the shared suite's rows intact.
it.skipIf(process.env.BOITE_E2E_ONBOARDING !== "1")("shows onboarding without the flag and skips it with the flag", async () => {
  await stopApp();
  const dev = new DevApp();
  try {
    await dev.start({ fresh: true, skipOnboarding: false });
    await settleWindow(dev);
    await dev.waitFor(`return !!document.querySelector('[role="dialog"][aria-modal="true"]')`);
    expect(await dev.js(`const {settings}=await import('/src/lib/features/settings/store.svelte.ts'); return settings.state.setupCompleted`)).toBe(false);
    if (process.env.BOITE_E2E_SHOT) await dev.screenshot(`${process.env.BOITE_E2E_SHOT}-onboarding.png`);
    await dev.start({ restart: true, fresh: true, skipOnboarding: true });
    await settleWindow(dev);
    await dev.waitFor(`const {settings}=await import('/src/lib/features/settings/store.svelte.ts'); return settings.ready && settings.state.setupCompleted`);
    expect(await dev.js(`return document.querySelector('[role="dialog"][aria-modal="true"]') === null`)).toBe(true);
    expect(await dev.db("SELECT json_extract(value, '$.setupCompleted') AS completed FROM settings WHERE key='main'")).toMatch(/completed\s+1/);
    if (process.env.BOITE_E2E_SHOT) await dev.screenshot(`${process.env.BOITE_E2E_SHOT}-skipped.png`);
  } finally {
    await dev.stop();
  }
}, 180_000);
