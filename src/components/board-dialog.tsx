"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

const subscribeMounted = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

function isInsidePanel(target: EventTarget | null, panel: HTMLElement | null) {
  return Boolean(panel && target instanceof Node && panel.contains(target));
}

function nearestScrollable(start: EventTarget | null, root: HTMLElement | null) {
  let node = start instanceof Element ? start : null;
  while (node && root?.contains(node)) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    if (node === root) break;
    node = node.parentElement;
  }
  return root;
}

export function BoardDialog({
  open,
  title,
  note,
  titleId,
  closeLabel,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  note?: string;
  titleId: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const mounted = useSyncExternalStore(subscribeMounted, clientMounted, serverMounted);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const page = document.querySelector("[data-page]");
    const scrollY = window.scrollY;
    const scrollbar = window.innerWidth - html.clientWidth;

    html.classList.add("dialog-open");
    body.style.paddingRight = scrollbar > 0 ? `${scrollbar}px` : "";
    if (page instanceof HTMLElement) {
      page.style.position = "fixed";
      page.style.top = `-${scrollY}px`;
      page.style.left = "0";
      page.style.right = "0";
      page.style.width = "100%";
    }

    function freezeBackground(event: WheelEvent | TouchEvent) {
      const panel = panelRef.current;
      if (panel && isInsidePanel(event.target, panel)) {
        if (!(event instanceof WheelEvent)) return;
        const scroller = nearestScrollable(event.target, panel.querySelector(".dialog-body") ?? panel);
        if (!scroller) return;
        const atTop = scroller.scrollTop <= 0 && event.deltaY < 0;
        const atBottom =
          scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && event.deltaY > 0;
        if (!atTop && !atBottom) return;
      }
      event.preventDefault();
    }

    window.addEventListener("wheel", freezeBackground, { passive: false });
    window.addEventListener("touchmove", freezeBackground, { passive: false });

    return () => {
      window.removeEventListener("wheel", freezeBackground);
      window.removeEventListener("touchmove", freezeBackground);
      html.classList.remove("dialog-open");
      body.style.paddingRight = "";
      if (page instanceof HTMLElement) {
        page.style.position = "";
        page.style.top = "";
        page.style.left = "";
        page.style.right = "";
        page.style.width = "";
      }
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="dialog-root">
      <div className="dialog-veil" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-panel"
      >
        <div className="dialog-head">
          <div>
            <h3 id={titleId} className="font-medium">
              {title}
            </h3>
            {note ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{note}</p> : null}
          </div>
          <Button type="button" size="sm" variant="ghost" aria-label={closeLabel ?? `关闭${title}`} onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
