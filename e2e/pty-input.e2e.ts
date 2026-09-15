import { expect, it } from "vitest";
import { app } from "./lib/harness";
import { REPO_ROOT } from "./lib/devApp";

it("delivers concurrent Tauri writes to the PTY in call order", async () => {
  const dev = await app();
  const expected = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(8);
  const output = await dev.js<string>(`
    const {tauriPty}=await import('/src/lib/backend/tauri/pty.ts');
    const encoder=new TextEncoder();
    let output='';
    let id=null;
    let cursorRequested=false;
    const cursor=()=>tauriPty.write(id,encoder.encode('\\x1b[1;1R'));
    id=await tauriPty.open({threadId:'e2e-input-order',spec:{
      cmd:'node',args:['-e',${JSON.stringify("process.stdin.setRawMode(true); let s=''; process.stdin.on('data',d=>{s+=d.toString();if(s.includes('!'))console.log('RESULT:'+s)}); console.log('READY');")}],
      cwd:${JSON.stringify(REPO_ROOT)},cols:500,rows:24
    }},event=>{
      if(event.type!=='output')return;
      const text=new TextDecoder().decode(event.bytes);
      output+=text;
      if(text.includes('\\x1b[6n')){cursorRequested=true;if(id)void cursor();}
    });
    if(cursorRequested)await cursor();
    const wait=async(text)=>{
      const end=Date.now()+10000;
      while(!output.includes(text)){
        if(Date.now()>end)throw new Error('PTY output timeout: '+output);
        await new Promise(r=>setTimeout(r,20));
      }
    };
    try{
      await wait('READY');
      await Promise.all([...${JSON.stringify(expected)}].map(c=>tauriPty.write(id,encoder.encode(c))));
      await tauriPty.write(id,encoder.encode('!'));
      await wait('RESULT:');
      return output;
    }finally{await tauriPty.kill(id);}
  `);
  expect(output).toContain(`RESULT:${expected}!`);
});
