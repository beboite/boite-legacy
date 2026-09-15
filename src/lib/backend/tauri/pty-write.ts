type Send = (key: string, data: Uint8Array) => Promise<void>;

const MAX_PENDING_WRITES = 1024;

export function createPtyWriter(send: Send): Send {
  const queues = new Map<string, { tail: Promise<void>; pending: number }>();
  return (key, data) => {
    let queue = queues.get(key);
    if (!queue) {
      queue = { tail: Promise.resolve(), pending: 0 };
      queues.set(key, queue);
    }
    if (queue.pending >= MAX_PENDING_WRITES) {
      return Promise.reject(new Error("pty write queue full: transport not responding"));
    }
    queue.pending++;
    const bytes = data.slice();
    // WebView2 runs custom-protocol fetches concurrently. A later key must not
    // reach ConPTY before the host has queued the preceding write.
    const result = queue.tail.then(() => send(key, bytes));
    const settled = () => {
      queue.pending--;
      if (queue.pending === 0) queues.delete(key);
    };
    queue.tail = result.then(settled, settled);
    return result;
  };
}
