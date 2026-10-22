// Operator keys (design section 7). Keyboard only, no on-screen buttons.
export type KeyAction = "pip" | "theme" | "fullscreen" | "chase" | "high" | "reset";

const ACTIONS: Record<string, KeyAction> = {
  c: "pip",
  t: "theme",
  f: "fullscreen",
  "1": "chase",
  "2": "high",
  r: "reset",
};

type KeyLike = Pick<KeyboardEvent, "key" | "repeat" | "ctrlKey" | "metaKey" | "altKey">;

// The action for a key press, or null. Browser shortcuts (Ctrl+R, Cmd+F) and
// auto-repeat are left alone.
export function keyAction(e: KeyLike): KeyAction | null {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  return ACTIONS[e.key.toLowerCase()] ?? null;
}

export function bindKeys(handler: (action: KeyAction) => void): void {
  window.addEventListener("keydown", (e) => {
    const action = keyAction(e);
    if (action) handler(action);
  });
}

export function toggleFullscreen(): void {
  const done = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
  // A refused request (no user gesture, kiosk policy) must not surface as an error.
  done.catch(() => {});
}
