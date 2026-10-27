// Required fields that the frame loop in main.ts reads without a check, per
// message type (schema/v1/*.json). Every known type also has a number t_ms.
const REQUIRED = new Map<string, Record<string, "array" | "number">>([
  ["ego", { speed_mps: "number" }],
  ["map", { features: "array" }],
  ["objects", { objects: "array" }],
  ["lanes", { lanes: "array" }],
  ["trajectory", { pts: "array" }],
  ["alerts", { alerts: "array" }],
  ["control", {}],
  ["status", {}],
]);

// False for a message of a known type with a required array that is not an
// array or a required number that is not finite. The page drops such a
// message before it is stored, so it cannot throw in every frame. Unknown
// types pass.
export function isWellFormed(msg: Record<string, unknown>): boolean {
  const fields = REQUIRED.get(msg.type as string);
  if (!fields) return true;
  return (
    Number.isFinite(msg.t_ms) &&
    Object.entries(fields).every(([k, kind]) =>
      kind === "array" ? Array.isArray(msg[k]) : Number.isFinite(msg[k]),
    )
  );
}
