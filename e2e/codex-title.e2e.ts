// Replay Codex OSC titles through a real PTY and verify the sidebar and saved row.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { app, completeSetup } from "./lib/harness";

it("keeps a Codex name through rename progress and restart", async () => {
  const dev = await app();
  await completeSetup(dev);
  const dir = mkdtempSync(path.join(tmpdir(), "boite-title-"));
  const control = path.join(dir, "title.txt");
  const fixture = path.join(dir, "osc.mjs");
  writeFileSync(control, "renaming... ⠋ | " + path.basename(dir));
  writeFileSync(fixture, `
    import { readFileSync } from 'node:fs';
    let previous;
    setInterval(() => {
      const title = readFileSync(process.argv[2], 'utf8');
      if (title === previous) return;
      previous = title;
      process.stdout.write('\\x1b]0;' + title + '\\x07' + '\\r\\nTITLE: ' + title + '\\r\\n');
    }, 100);
  `);
  const id = "e2e-codex-title";
  await dev.js(`
    const invoke = window.__TAURI__.core.invoke;
    await invoke('records_project_create', { params: { project: {
      id: 'e2e-title-project', name: 'Title regression', cwd: ${JSON.stringify(dir)},
      icon: null, archived: false, worktrees: false
    } } });
    await invoke('records_thread_create', { params: { thread: {
      id: '${id}', projectId: 'e2e-title-project', label: 'Codex #1',
      title: 'renaming... ⠋ | project', cmd: 'node', args: ${JSON.stringify([fixture, control])},
      iconKey: 'terminal', sessionId: null, status: 'idle', exitCode: null,
      ptyId: null, createdAt: Date.now(), keepAwake: true
    } } });
    location.reload();
    return true;
  `);
  await dev.waitFor("return !!window.__boite");
  await completeSetup(dev);
  await dev.waitFor(`return !!document.querySelector('li[data-thread-id="${id}"]')`);
  const label = () => dev.js<string>(`return document.querySelector('li[data-thread-id="${id}"]').innerText`);
  expect(await label()).toContain("Codex #1");
  await dev.click(`li[data-thread-id="${id}"] button[data-nav-row]`);
  await dev.waitForText(() => dev.inspect("read", { id }).then(JSON.stringify), text => text.includes("TITLE:"));
  expect(await label()).toContain("Codex #1");
  expect(await label()).not.toContain("renaming");
  writeFileSync(control, "Fix login ⠙ | " + path.basename(dir));
  await dev.waitForText(label, text => text.includes("Fix login"));
  expect(await label()).not.toContain("⠙");
  expect(await label()).not.toContain(path.basename(dir));
  writeFileSync(control, "renaming... ⠹ | " + path.basename(dir));
  await dev.waitForText(() => dev.inspect("read", { id }).then(JSON.stringify), text => text.includes("⠹"));
  expect(await label()).toContain("Fix login");
  await dev.waitForText(() => dev.db(`SELECT title FROM threads WHERE id = '${id}'`), text => text.includes("Fix login"));
  if (process.env.BOITE_E2E_SHOT) await dev.screenshot(process.env.BOITE_E2E_SHOT);
  await dev.js("location.reload(); return true;");
  await dev.waitFor(`return !!document.querySelector('li[data-thread-id="${id}"]')`);
  expect(await label()).toContain("Fix login");
});
