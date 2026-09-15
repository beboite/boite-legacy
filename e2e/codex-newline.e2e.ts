// Opt in with BOITE_E2E_CODEX=1: requires an installed, initialized Codex CLI.
// An unknown slash command exercises submission without starting a model turn.
import { expect, it } from "vitest";
import { app, completeSetup } from "./lib/harness";
import { REPO_ROOT } from "./lib/devApp";

it.skipIf(process.env.BOITE_E2E_CODEX !== "1")("inserts Codex prompt newlines without submitting", async () => {
  const dev = await app();
  await completeSetup(dev);
  const id = `e2e-codex-newline-${Date.now()}`;
  await dev.js(`
    const invoke = window.__TAURI__.core.invoke;
    await invoke('records_project_create', { params: { project: {
      id: 'e2e-newline-project', name: 'Newline regression', cwd: ${JSON.stringify(REPO_ROOT)},
      icon: null, archived: false, worktrees: false
    } } });
    await invoke('records_thread_create', { params: { thread: {
      id: '${id}', projectId: 'e2e-newline-project', label: 'Codex newline',
      title: null, cmd: 'codex', args: [], iconKey: 'codex', sessionId: null,
      status: 'idle', exitCode: null, ptyId: null, createdAt: Date.now(), keepAwake: true
    } } });
    location.reload(); return true;
  `);
  await dev.waitFor("return !!window.__boite");
  await completeSetup(dev);
  await dev.waitFor(`return !!document.querySelector('li[data-thread-id="${id}"] button[data-nav-row]')`);
  await dev.click(`li[data-thread-id="${id}"] button[data-nav-row]`);
  await dev.waitFor(`
    const { liveTerminal } = await import('/src/lib/shared/terminals.ts');
    return window.__boite.thread('${id}').running && liveTerminal('${id}')?.options.disableStdin === false;
  `);
  const screen = () => dev.js<string>(`
    const { liveTerminal, terminalText } = await import('/src/lib/shared/terminals.ts');
    const term = liveTerminal('${id}');
    return term ? terminalText(term) : '';
  `);
  const input = (text: string) => dev.js(`
    const { liveTerminal } = await import('/src/lib/shared/terminals.ts');
    liveTerminal('${id}').input(${JSON.stringify(text)}, true); return true;
  `);
  const key = (key: string, code: string, keyCode: number, shiftKey = false, ctrlKey = false) => dev.js(`
    const { liveTerminal } = await import('/src/lib/shared/terminals.ts');
    liveTerminal('${id}').textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, keyCode: ${keyCode}, which: ${keyCode},
      shiftKey: ${shiftKey}, ctrlKey: ${ctrlKey}, bubbles: true, cancelable: true
    })); return true;
  `);
  await dev.waitForText(screen, text => text.includes("context") || text.includes("Context"));
  await input("/model");
  await dev.waitForText(screen, text => text.includes("/model  choose"));
  await key("Enter", "Enter", 13);
  await dev.waitForText(screen, text => text.includes("Select Model"));
  await key("Escape", "Escape", 27);
  await dev.waitForText(screen, text => !text.includes("Select Model"));
  await input("/boite-newline-regression");
  await dev.waitForText(screen, text => text.includes("/boite-newline-regression"));
  await input("X");
  await dev.waitForText(screen, text => text.includes("/boite-newline-regressionX"));
  await key("Backspace", "Backspace", 8);
  await dev.waitForText(screen, text => !text.includes("/boite-newline-regressionX"));
  await key("Enter", "Enter", 13, true);
  await input("SECOND-LINE");
  await dev.waitForText(screen, text => /boite-newline-regression\s*\n\s*SECOND-LINE/.test(text));
  await key("j", "KeyJ", 74, false, true);
  await input("THIRD-LINE");
  await dev.waitForText(screen, text => /SECOND-LINE\s*\n\s*THIRD-LINE/.test(text));
  await input("X");
  await dev.waitForText(screen, text => text.includes("THIRD-LINEX"));
  await key("Backspace", "Backspace", 8);
  await dev.waitForText(screen, text => !text.includes("THIRD-LINEX"));
  expect(await screen()).not.toContain("Unrecognized command");
  if (process.env.BOITE_E2E_SHOT) await dev.screenshot(process.env.BOITE_E2E_SHOT);
  await key("Enter", "Enter", 13);
  await dev.waitForText(screen, text => text.includes("Unrecognized command"));
});
