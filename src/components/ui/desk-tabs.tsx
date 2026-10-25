"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SheetHead } from "@/components/ui/sheet";

export type DeskTabItem = {
  id: string;
  label: string;
  hash?: string;
  children: ReactNode;
};

export function DeskTabs({
  items,
  className,
}: {
  items: DeskTabItem[];
  className?: string;
}) {
  const [active, setActive] = useState("");
  const hashKey = items.map((item) => `${item.id}:${item.hash ?? ""}`).join("|");

  useEffect(() => {
    function applyHash() {
      const hash = window.location.hash.replace("#", "");
      if (!hash) return;
      const match = items.find((item) => item.id === hash || item.hash === hash);
      if (match) setActive(match.id);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
    // items content is keyed; avoid rerunning on new children identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashKey]);

  const current = items.find((item) => item.id === active);

  function select(id: string) {
    setActive((prev) => {
      const next = prev === id ? "" : id;
      const item = items.find((row) => row.id === next);
      const url = new URL(window.location.href);
      url.hash = item?.hash ?? "";
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      return next;
    });
  }

  return (
    <div className={cn("sheet-pad", className)}>
      {items.map((item) =>
        item.hash ? <div key={item.hash} id={item.hash} className="scroll-mt-24" /> : null,
      )}
      <SheetHead title="本单资料" hint="改色尺、工厂、补资料或分色时点下面。不是另一套菜单。" />
      <div className="desk-tabs mt-4" role="tablist" aria-label="本单资料">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`desk-tab-${item.id}`}
            aria-selected={active === item.id}
            aria-controls={`desk-panel-${item.id}`}
            className="desk-tab"
            onClick={() => select(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {current ? (
        <div
          id={`desk-panel-${current.id}`}
          role="tabpanel"
          aria-labelledby={`desk-tab-${current.id}`}
          className="mt-5"
        >
          {current.children}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-[var(--ink-muted)]">先看上面的提案、收付、门槛和料况。</p>
      )}
    </div>
  );
}
