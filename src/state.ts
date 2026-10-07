export type EndpointState = {
  roles: string[];
  latest: Record<string, Record<string, unknown>>; // message type -> last message
  closed: boolean;
};

const store = new Map<string, EndpointState>();

export function setRoles(name: string, roles: string[]): void {
  // Reset latest on every (re)connect so stale messages from the last session
  // are not served to the renderer after a reconnect.
  store.set(name, { roles, latest: {}, closed: false });
}

export function recordMessage(name: string, msg: Record<string, unknown>): void {
  const s = store.get(name) ?? { roles: [], latest: {}, closed: false };
  s.latest[msg.type as string] = msg;
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

// Find the latest message of a given type across all endpoints carrying a role.
// Searches closed endpoints too so ego-mesh stays at its last known pose when
// the vehicle endpoint drops (design section 4).
export function latestByRole(role: string, type: string): Record<string, unknown> | undefined {
  for (const s of store.values()) {
    if (s.roles.includes(role) && s.latest[type]) return s.latest[type];
  }
  return undefined;
}
