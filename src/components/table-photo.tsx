"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ZoomIn, ZoomOut, X } from "lucide-react";

/** A native dialog also works above the master table's fullscreen dialog. */
function PhotoPreview({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [scale, setScale] = useState(100);
  useEffect(() => {
    const dialog = ref.current;
    const overflow = document.documentElement.style.overflow;
    dialog?.showModal();
    document.documentElement.style.overflow = "hidden";
    return () => { dialog?.close(); document.documentElement.style.overflow = overflow; };
  }, []);
  return createPortal(<dialog ref={ref} data-no-zoom className="table-photo-dialog" aria-label={`${label}大图`} onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] p-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-4">
        <button type="button" aria-label="缩小图片" disabled={scale <= 50} onClick={() => setScale(value => value - 25)}><ZoomOut size={20} /></button>
        <button type="button" onClick={() => setScale(100)} aria-label="恢复图片大小">{scale}%</button>
        <button type="button" aria-label="放大图片" disabled={scale >= 300} onClick={() => setScale(value => value + 25)}><ZoomIn size={20} /></button>
        <button type="button" aria-label="关闭图片" onClick={onClose}><X size={22} /></button>
      </div>
    </div>
    <div className="table-photo-view"><div style={{ width: `${scale}%`, minWidth: `${scale}%`, height: `${scale}%` }}><Image src={src} alt={label} width={1600} height={1600} unoptimized className="mx-auto h-full w-full object-contain" /></div></div>
  </dialog>, document.body);
}

export function TablePhoto({ src, label, compact = false, className = "" }: { src: string; label: string; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!src) return <span className="block w-14 shrink-0 py-3 text-center text-xs text-[var(--ink-muted)]">未上传图</span>;
  return <><button type="button" data-no-zoom aria-label={`查看${label}大图`} title="点击放大图片" className={`relative block shrink-0 cursor-zoom-in ${className}`} onClick={() => setOpen(true)}>
    <Image src={src} alt={label} width={compact ? 48 : 56} height={compact ? 48 : 72} unoptimized className={compact ? "h-12 w-12 rounded object-contain" : "h-[72px] w-14 rounded object-contain"} />
    <span className="absolute bottom-0 right-0 rounded bg-[var(--paper)] p-0.5 text-[var(--brand-strong)]"><ZoomIn size={14} /></span>
  </button>{open ? <PhotoPreview src={src} label={label} onClose={() => setOpen(false)} /> : null}</>;
}
