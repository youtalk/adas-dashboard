export type EndpointState = {
  roles: string[];
  latest: Record<string, Record<string, unknown>>; // message type -> last message
};

const store = new Map<string, EndpointState>();

export function setRoles(name: string, roles: string[]): void {
  const s = store.get(name) ?? { roles: [], latest: {} };
  s.roles = roles;
  store.set(name, s);
}

export function recordMessage(name: string, msg: Record<string, unknown>): void {
  const s = store.get(name) ?? { roles: [], latest: {} };
  s.latest[msg.type as string] = msg;
  store.set(name, s);
}

export function getState(): Map<string, EndpointState> {
  return store;
}

// Find the latest message of a given type across all endpoints carrying a role.
// Useful once two endpoints could both send e.g. "status" (design section 4).
export function latestByRole(role: string, type: string): Record<string, unknown> | undefined {
  for (const s of store.values()) {
    if (s.roles.includes(role) && s.latest[type]) return s.latest[type];
  }
  return undefined;
}
