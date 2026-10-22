import { loadPalette } from "./style";

export type Theme = "dark" | "light";

// Switch the CSS tokens (index.html) and copy the scene colors from them.
// The caller then re-colors the scene (design section 6.5, key t).
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const css = getComputedStyle(root);
  loadPalette((token) => css.getPropertyValue(token));
}
