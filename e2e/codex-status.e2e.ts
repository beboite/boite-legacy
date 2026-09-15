import { expect, it } from "vitest";
import { app, completeSetup } from "./lib/harness";
import { REPO_ROOT } from "./lib/devApp";
import path from "node:path";

it("reads Codex's separated status row and returns to ready when it disappears", async () => {
  const dev = await app();
  await completeSetup(dev);
  const id = "e2e-codex-status";
  const fixture = path.join(REPO_ROOT, "e2e", "fixtures", "codex-status.mjs");
  await dev.js(`
    const invoke = window.__TAURI__.core.invoke;
    await invoke('records_project_create', {params:{project:{id:'codex-status-project',name:'Codex status',cwd:${JSON.stringify(REPO_ROOT)},icon:null,archived:false,worktrees:false}}});
    await invoke('records_thread_create', {params:{thread:{id:'${id}',projectId:'codex-status-project',label:'Codex status regression',title:null,cmd:'node',args:[${JSON.stringify(fixture)}],iconKey:'terminal',sessionId:null,status:'idle',exitCode:null,ptyId:null,createdAt:Date.now(),keepAwake:true}}});
    location.reload(); return true;
  `);
  await dev.waitFor("return !!window.__boite");
  await completeSetup(dev);
  await dev.waitFor(`return !!document.querySelector('li[data-thread-id="${id}"] button[data-nav-row]')`);
  await dev.click(`li[data-thread-id="${id}"] button[data-nav-row]`);
  await dev.waitFor(`return window.__boite.read('${id}').text?.includes('esc to interrupt')`);
  await dev.js(`
    const {app}=await import('/src/lib/app/store.svelte.ts');
    const row=app.threadById('${id}'); row.iconKey='codex'; row.sessionId='codex-status-fixture';
    return true;
  `);
  const status = () => dev.js<string>(`const {app}=await import('/src/lib/app/store.svelte.ts'); return app.threadById('${id}').status`);
  await dev.waitForText(status, (text) => text === "running");
  await dev.js(`
    const {agentTurns}=await import('/src/lib/features/thread/agent-turns.ts');
    window.__originalStateOf=agentTurns.stateOf;
    window.__statusReads=0;
    agentTurns.stateOf=(kind,session,cwd)=>{
      if(session==='codex-status-fixture') { window.__statusReads++; return {state:'idle'}; }
      return window.__originalStateOf(kind,session,cwd);
    };
    return true;
  `);
  await dev.waitFor(`return window.__statusReads >= 3`);
  expect(await status()).toBe("running");
  if (process.env.BOITE_E2E_SHOT) await dev.screenshot(`${process.env.BOITE_E2E_SHOT}-working.png`);
  await dev.js(`
    const {liveTerminal}=await import('/src/lib/shared/terminals.ts');
    liveTerminal('${id}').input('done\\r',true); return true;
  `);
  await dev.waitForText(status, (text) => text === "ready");
  if (process.env.BOITE_E2E_SHOT) await dev.screenshot(`${process.env.BOITE_E2E_SHOT}-ready.png`);
  await dev.js(`
    const {agentTurns}=await import('/src/lib/features/thread/agent-turns.ts');
    agentTurns.stateOf=window.__originalStateOf;
    return true;
  `);
});
