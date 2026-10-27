import { afterEach, describe, expect, it, vi } from "vitest";
import { connectEndpoint, connectionStatus, rejected } from "./ws";

// Stands in for the browser WebSocket. close() fires onclose at once.
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  close() {
    this.onclose?.();
  }
  hello(schema: number) {
    this.onopen?.();
    const msg = { source: "s", type: "hello", t_ms: 0, schema, roles: ["stack"], name: "s" };
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connectEndpoint", () => {
  it("keeps reconnecting after a schema mismatch and clears it on a good hello", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const onHello = vi.fn();
    connectEndpoint("stack", "ws://x", { onHello, onMessage: vi.fn(), onClose: vi.fn() });

    FakeSocket.all[0].hello(2);
    expect(rejected.get("stack")).toBe(2);
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.all).toHaveLength(2);

    // Still the wrong schema: the retry stays at the 5 s maximum.
    FakeSocket.all[1].hello(2);
    vi.advanceTimersByTime(4999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);

    FakeSocket.all[2].hello(1);
    expect(rejected.has("stack")).toBe(false);
    expect(onHello).toHaveBeenCalledOnce();
  });
});

describe("connectionStatus", () => {
  it("is empty when all is well", () => {
    expect(connectionStatus(new Map(), false, false)).toBe("");
  });

  it("waits for the vehicle while Connecting", () => {
    expect(connectionStatus(new Map(), true, true)).toBe("Waiting for vehicle...");
  });

  it("lists every rejected endpoint and keeps vehicle link lost", () => {
    const r = new Map([
      ["stack", 2],
      ["world", 3],
    ]);
    expect(connectionStatus(r, false, true)).toBe(
      "stack: unsupported schema 2, world: unsupported schema 3, vehicle link lost",
    );
  });
});
