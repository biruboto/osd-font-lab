// js/modules/theme.js
export const THEME_KEY = "osdFontLabTheme";

export function applyTheme(theme, root = document.documentElement) {
  if (!theme || theme === "dusk") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function currentThemeId(root = document.documentElement) {
  return root.getAttribute("data-theme") || "dusk";
}

export function initThemeControls({
  themeRadios,
  key = THEME_KEY,
  storage = window.localStorage,
  onThemeChange,
  root = document.documentElement,
}) {
  if (!Array.isArray(themeRadios) || !themeRadios.length) return;

  const saved = storage.getItem(key) || "dusk";
  const initial = themeRadios.some((r) => r.value === saved) ? saved : themeRadios[0].value;

  for (const radio of themeRadios) {
    radio.checked = radio.value === initial;
  }

  for (const radio of themeRadios) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      const theme = radio.value;
      storage.setItem(key, theme);
      applyTheme(theme, root);
      onThemeChange?.(theme);
    });
  }

  storage.setItem(key, initial);
  applyTheme(initial, root);
  onThemeChange?.(initial);
}
