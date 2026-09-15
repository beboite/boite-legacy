import { describe, expect, it } from "vitest";
import { createPtyWriter } from "./pty-write";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("PTY write ordering", () => {
  it("keeps backspace behind pending text without blocking another terminal", async () => {
    const first = deferred();
    const calls: string[] = [];
    const write = createPtyWriter(async (key, data) => {
      calls.push(`${key}:${data[0]}`);
      if (key === "a" && data[0] === 88) await first.promise;
    });
    const text = write("a", new Uint8Array([88]));
    const backspace = write("a", new Uint8Array([127]));
    await write("b", new Uint8Array([27]));
    expect(calls).toEqual(["a:88", "b:27"]);
    first.resolve();
    await Promise.all([text, backspace]);
    expect(calls).toEqual(["a:88", "b:27", "a:127"]);
  });

  it("reports a failed write and still delivers the next key", async () => {
    const calls: number[] = [];
    const write = createPtyWriter(async (_, data) => {
      calls.push(data[0]);
      if (data[0] === 88) throw new Error("write failed");
    });
    const failed = write("a", new Uint8Array([88]));
    const escape = write("a", new Uint8Array([27]));
    await expect(failed).rejects.toThrow("write failed");
    await escape;
    expect(calls).toEqual([88, 27]);
  });

  it("preserves queued bytes when the caller reuses its buffer", async () => {
    const first = deferred();
    const calls: number[] = [];
    const write = createPtyWriter(async (_, data) => {
      calls.push(data[0]);
      if (calls.length === 1) await first.promise;
    });
    const a = write("a", new Uint8Array([65]));
    const buffer = new Uint8Array([27]);
    const escape = write("a", buffer);
    buffer[0] = 127;
    first.resolve();
    await Promise.all([a, escape]);
    expect(calls).toEqual([65, 27]);
  });

  it("bounds a stalled transport and accepts input again after draining", async () => {
    const first = deferred();
    const write = createPtyWriter(() => first.promise);
    const pending = Array.from({ length: 1024 }, () => write("a", new Uint8Array([65])));
    await expect(write("a", new Uint8Array([27]))).rejects.toThrow("queue full");
    first.resolve();
    await Promise.all(pending);
    await expect(write("a", new Uint8Array([27]))).resolves.toBeUndefined();
  });
});
