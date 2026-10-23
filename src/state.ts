export type EndpointState = {
  roles: string[];
  label: string; // hello.name
  latest: Record<string, Record<string, unknown>>; // message type -> last message
  seq: Record<string, number>; // message type -> arrival order of the last message
  closed: boolean;
};

const store = new Map<string, EndpointState>();

// Arrival counter shared by all endpoints. Sender clocks are not aligned
// (design section 5.1), so "newest" means "arrived last".
let arrivals = 0;

export function setRoles(name: string, roles: string[], label: string = name): void {
  // Reset latest on every (re)connect so stale messages from the last session
  // are not served to the renderer after a reconnect.
  store.set(name, { roles, label, latest: {}, seq: {}, closed: false });
}

export function recordMessage(name: string, msg: Record<string, unknown>): void {
  const s = store.get(name) ?? { roles: [], label: name, latest: {}, seq: {}, closed: false };
  s.latest[msg.type as string] = msg;
  s.seq[msg.type as string] = ++arrivals;
  store.set(name, s);
}

export function closeEndpoint(name: string): void {
  const s = store.get(name);
  if (s) s.closed = true;
}

export function liveEndpoints(): string[] {
  return [...store.entries()].filter(([, s]) => !s.closed).map(([n]) => n);
}

export function closedEndpoints(): string[] {
  return [...store.entries()].filter(([, s]) => s.closed).map(([n]) => n);
}

// True once any endpoint has sent hello (design section 6.3 Connecting).
export function anyHello(): boolean {
  return store.size > 0;
}

// Find the latest message of a given type across all endpoints carrying a role.
// Searches closed endpoints too so ego-mesh stays at its last known pose when
// the vehicle endpoint drops (design section 4).
export function latestByRole(role: string, type: string): Record<string, unknown> | undefined {
  for (const s of store.values()) {
    if (s.roles.includes(role) && s.latest[type]) return s.latest[type];
  }
  return undefined;
}

// Return the latest message of a given type from EVERY endpoint carrying a role.
// Used for alerts: the page shows the union of alert lists from all endpoints
// (design section 4: "The page shows the union of the lists from all endpoints").
export function allByRole(role: string, type: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const s of store.values()) {
    if (!s.closed && s.roles.includes(role) && s.latest[type]) results.push(s.latest[type]);
  }
  return results;
}

// The last message of a type to arrive from any endpoint, closed ones included.
// Design section 5.2: the newest control message from any endpoint is the truth.
export function newestOfType(type: string): Record<string, unknown> | undefined {
  let best: EndpointState | undefined;
  for (const s of store.values()) {
    if (s.latest[type] && (!best || s.seq[type] > best.seq[type])) best = s;
  }
  return best?.latest[type];
}

// Design section 6.3: the stack is alive while a stack endpoint is open and
// its status does not say "lost".
export function stackAlive(): boolean {
  for (const s of store.values()) {
    if (s.closed || !s.roles.includes("stack")) continue;
    if ((s.latest.status as { mode?: string } | undefined)?.mode !== "lost") return true;
  }
  return false;
}

// True when every endpoint carrying the role has closed (design section 6.3:
// "vehicle link lost"). False when no endpoint ever carried it.
export function roleLost(role: string): boolean {
  let seen = false;
  for (const s of store.values()) {
    if (!s.roles.includes(role)) continue;
    if (!s.closed) return false;
    seen = true;
  }
  return seen;
}

// Display name for a role: the status name, else the hello name.
export function roleName(role: string): string | undefined {
  const status = latestByRole(role, "status") as { name?: string } | undefined;
  if (status?.name) return status.name;
  for (const s of store.values()) if (s.roles.includes(role)) return s.label;
  return undefined;
}

// Drop the latest message of a type on every endpoint (key r, design section 7).
export function clearType(type: string): void {
  for (const s of store.values()) {
    delete s.latest[type];
    delete s.seq[type];
  }
}
