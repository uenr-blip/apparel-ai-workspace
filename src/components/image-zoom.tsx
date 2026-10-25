"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { shouldOpenImageZoom } from "@/lib/image-zoom";

type Zoomed = { src: string; alt: string };

export function ImageZoomRoot() {
  const [zoomed, setZoomed] = useState<Zoomed | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!shouldOpenImageZoom(event.target)) return;
      const image = event.target as HTMLImageElement;
      event.preventDefault();
      event.stopPropagation();
      setZoomed({ src: image.currentSrc || image.src, alt: image.alt || "放大查看" });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!zoomed) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setZoomed(null);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomed]);

  if (!zoomed || typeof document === "undefined") return null;
  return createPortal(
    <div className="image-zoom-layer" role="dialog" aria-modal="true" aria-label="放大图片" onClick={() => setZoomed(null)}>
      {/* The zoom source is the photo's already resolved URL. next/image cannot load that without a remote pattern. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={zoomed.src} alt={zoomed.alt} data-no-zoom="true" />
      <p>点击空白处关闭</p>
    </div>,
    document.body,
  );
}
