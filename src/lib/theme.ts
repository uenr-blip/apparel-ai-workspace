export const THEME_STORAGE_KEY = "yiju-theme";

export const THEMES = ["atelier", "noir"] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_LABEL: Record<ThemeName, string> = {
  atelier: "纸色",
  noir: "墨黑",
};

export function isThemeName(value: string | null | undefined): value is ThemeName {
  return value === "atelier" || value === "noir";
}

/** SSR and first client paint must match. Read localStorage only after mount. */
export function serverSafeTheme(): ThemeName {
  return "atelier";
}

export function themeFromDocument(
  doc?: { documentElement: { getAttribute(name: string): string | null } } | null,
): ThemeName {
  return doc?.documentElement.getAttribute("data-theme") === "noir" ? "noir" : "atelier";
}

export const THEME_BOOTSTRAP_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="noir")document.documentElement.setAttribute("data-theme","noir");}catch(e){}`;
