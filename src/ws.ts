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
  onSchemaMismatch: (name: string, schema: number) => void;
  onMessage: (name: string, msg: Record<string, unknown>) => void;
  onClose: (name: string) => void;
};

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 5000;

export function connectEndpoint(name: string, url: string, cb: Callbacks): void {
  let backoff = BACKOFF_MIN_MS;
  let gotHello = false;

  function open() {
    const ws = new WebSocket(url);
    gotHello = false;

    ws.onopen = () => {
      backoff = BACKOFF_MIN_MS; // reset backoff on a clean connect
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return; // ignore malformed frames
      }

      if (!gotHello) {
        if (msg.type !== "hello") return; // spec: hello is sent once, right after open
        gotHello = true;
        const hello = msg as unknown as Hello;
        if (hello.schema !== 1) {
          cb.onSchemaMismatch(name, hello.schema);
          ws.close();
          return;
        }
        cb.onHello(name, hello);
        return;
      }

      cb.onMessage(name, msg);
    };

    ws.onclose = () => {
      cb.onClose(name);
      if (gotHello === false && backoff >= BACKOFF_MAX_MS) return; // schema mismatch: stop retrying that reason, still allowed to retry connection-wise below
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    };

    ws.onerror = () => {
      // onclose fires after onerror for browser WebSockets; no separate handling needed
    };
  }

  open();
}
