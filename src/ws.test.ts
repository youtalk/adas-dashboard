import { afterEach, describe, expect, it, vi } from "vitest";
import { badUrls, connectEndpoint, connectionStatus, rejected } from "./ws";

// Stands in for the browser WebSocket. close() fires onclose at once.
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    // A host with "[" is one URL that Chrome's WebSocket constructor rejects at once.
    if (url.includes("[")) throw new SyntaxError(`The URL '${url}' is invalid.`);
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

describe("connectEndpoint with a bad URL", () => {
  it("reports it, never retries it, and leaves the other endpoints alone", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    FakeSocket.all = [];
    const cb = { onHello: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
    // The loop in main.ts, with the bad URL first.
    connectEndpoint("bogus", "ws://bad[url/x", cb);
    connectEndpoint("stack", "ws://127.0.0.1:8090/stack", cb);
    connectEndpoint("world", "ws://127.0.0.1:8091/world", cb);

    expect([...badUrls]).toEqual(["bogus"]);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(2);
  });
});

describe("connectionStatus", () => {
  it("is empty when all is well", () => {
    expect(connectionStatus(new Map(), new Set(), false, false)).toBe("");
  });

  it("waits for the vehicle while Connecting", () => {
    expect(connectionStatus(new Map(), new Set(), true, true)).toBe("Waiting for vehicle...");
  });

  it("puts a bad URL first", () => {
    expect(connectionStatus(new Map([["world", 2]]), new Set(["stack"]), true, false)).toBe(
      "stack: bad URL, world: unsupported schema 2, Waiting for vehicle...",
    );
  });

  it("lists every rejected endpoint and keeps vehicle link lost", () => {
    const r = new Map([
      ["stack", 2],
      ["world", 3],
    ]);
    expect(connectionStatus(r, new Set(), false, true)).toBe(
      "stack: unsupported schema 2, world: unsupported schema 3, vehicle link lost",
    );
  });
});
