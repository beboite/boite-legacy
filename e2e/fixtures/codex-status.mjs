function paint(working) {
  const status = working
    ? "• Monitoring builds and tests (5m 04s · esc to interrupt) · 1 background terminal running"
    : "• Worked for 5m 04s";
  process.stdout.write(`\x1b[2J\x1b[H${status}\r\n\r\n› Ask Codex to do anything\r\n\r\n  Context 38% used\r\n`);
}

paint(true);
process.stdin.on("data", (data) => paint(!data.toString().includes("done")));
setInterval(() => {}, 1000);
