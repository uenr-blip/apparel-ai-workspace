"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { serverSafeTheme, THEME_LABEL, THEME_STORAGE_KEY, themeFromDocument, type ThemeName } from "@/lib/theme";

function ExpandIcon({ exit = false }: { exit?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      {exit ? (
        <path
          d="M8 3v5H3M16 3v5h5M3 16h5v5M16 16h5v5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="square"
        />
      ) : (
        <path
          d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="square"
        />
      )}
    </svg>
  );
}

const themeListeners = new Set<() => void>();

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function readTheme() {
  return themeFromDocument(document);
}

function publishTheme(next: ThemeName) {
  const root = document.documentElement;
  if (next === "noir") root.setAttribute("data-theme", "noir");
  else root.removeAttribute("data-theme");
  localStorage.setItem(THEME_STORAGE_KEY, next);
  for (const listener of themeListeners) listener();
}

export function ChromeControls({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverSafeTheme);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const onFullscreen = () => {
      if (document.fullscreenElement) return;
      root.removeAttribute("data-expanded");
      setExpanded(false);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  function applyTheme(next: ThemeName) {
    publishTheme(next);
  }

  async function toggleExpanded() {
    const root = document.documentElement;
    const next = !root.hasAttribute("data-expanded");
    try {
      if (next) {
        await root.requestFullscreen();
        root.setAttribute("data-expanded", "");
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
        root.removeAttribute("data-expanded");
      } else {
        root.removeAttribute("data-expanded");
      }
    } catch {
      if (next) root.setAttribute("data-expanded", "");
      else root.removeAttribute("data-expanded");
    }
    setExpanded(next);
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex rounded-full border border-[var(--line)] bg-[var(--surface-solid)]/70 p-0.5 text-[11px] tracking-[0.12em]">
        {(["atelier", "noir"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={theme === item}
            onClick={() => applyTheme(item)}
            className={cn(
              "rounded-full px-2.5 py-1 transition-colors",
              theme === item
                ? "bg-[var(--brand)] text-[var(--on-brand)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
            )}
          >
            {THEME_LABEL[item]}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={expanded}
        aria-label={expanded ? "退出铺满窗口" : "铺满窗口"}
        title={expanded ? "退出铺满窗口" : "铺满窗口"}
        onClick={() => void toggleExpanded()}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-solid)]/70 text-[var(--ink)] hover:bg-[var(--nav-hover)]"
      >
        <ExpandIcon exit={expanded} />
      </button>
    </div>
  );
}
