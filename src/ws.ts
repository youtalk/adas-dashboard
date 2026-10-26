export type Hello = {
  source: string;
  type: "hello";
  t_ms: number;
  schema: number;
  roles: string[];
  name: string;
  device?: string;
};

export type EndpointHandle = {
  name: string;
  roles: string[];
  send: (obj: unknown) => void;
};

type Callbacks = {
  onHello: (name: string, hello: Hello) => void;
  onMessage: (name: string, msg: Record<string, unknown>) => void;
  onClose: (name: string) => void;
};

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 5000;

// Endpoint name -> the unsupported hello.schema it sent (design section 5).
// Cleared when the endpoint later sends a good hello.
export const rejected = new Map<string, number>();

// Bottom-left line (design section 6.3): every rejected endpoint, then
// "Waiting for vehicle..." while Connecting or "vehicle link lost".
export function connectionStatus(
  rejected: Map<string, number>,
  connecting: boolean,
  vehicleLost: boolean,
): string {
  const parts = [...rejected].map(([name, schema]) => `${name}: unsupported schema ${schema}`);
  if (connecting) parts.push("Waiting for vehicle...");
  else if (vehicleLost) parts.push("vehicle link lost");
  return parts.join(", ");
}

export function connectEndpoint(name: string, url: string, cb: Callbacks): void {
  let backoff = BACKOFF_MIN_MS;

  function open() {
    const ws = new WebSocket(url);
    let gotHello = false;

    ws.onopen = () => {
      backoff = BACKOFF_MIN_MS; // reset backoff on a clean connect
    };

    ws.onmessage = (ev: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data as string);
      } catch {
        return; // ignore malformed frames
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      const msg = parsed as Record<string, unknown>;
      if (typeof msg.type !== "string") return;

      if (!gotHello) {
        if (msg.type !== "hello") return; // spec: hello is sent once, right after open
        const hello = msg as unknown as Hello;
        if (!Array.isArray(hello.roles)) {
          ws.close();
          return;
        }
        gotHello = true;
        if (hello.schema !== 1) {
          // Keep retrying at the slowest rate: the endpoint may restart with schema 1.
          backoff = BACKOFF_MAX_MS;
          rejected.set(name, hello.schema);
          ws.close();
          return;
        }
        rejected.delete(name);
        cb.onHello(name, hello);
        return;
      }

      cb.onMessage(name, msg);
    };

    ws.onclose = () => {
      cb.onClose(name);
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    };

    ws.onerror = () => {
      // onclose fires after onerror for browser WebSockets; no separate handling needed
    };
  }

  open();
}
