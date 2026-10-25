"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { MAX_CELL_PICTURES } from "@/server/domain/merch-sheet";
import { uploadSheetImage } from "./sheet-picture";

/** Pictures are draft references until the surrounding follow sheet is saved. */
export function CellImageEditor({ label, images = [], disabled, onChange, onUploadChange }: {
  label: string; images?: string[]; disabled: boolean;
  onChange: (images: string[]) => void;
  onUploadChange: (delta: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function upload(file: File) {
    if (busy.current || disabled || images.length >= MAX_CELL_PICTURES) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("请选择 5MB 以内的 JPG 或 PNG 图片"); return;
    }
    busy.current = true; setPending(true); setError(""); onUploadChange(1);
    try { onChange([...images, await uploadSheetImage(file)]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "图片没有传上，请重试"); }
    finally { busy.current = false; setPending(false); onUploadChange(-1); }
  }
  return <div className="relative mt-2 space-y-1" role="group" aria-label={`${label}图片`}>
    <div className="flex flex-wrap items-center gap-2">
      {images.map((src, index) => <div key={src} className="relative">
        <Image src={src} alt={`${label}图片 ${index + 1}`} width={48} height={48} unoptimized className="h-12 w-12 cursor-zoom-in rounded border border-[var(--line)] bg-[var(--paper)] object-contain" />
        {!disabled ? <button type="button" disabled={pending} aria-label={`移除${label}图片 ${index + 1}`} title="移除这张图片，保存后生效" className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-xs disabled:opacity-50" onClick={() => onChange(images.filter((_, i) => i !== index))}>×</button> : null}
      </div>)}
      {!disabled ? <button type="button" aria-label={`${label}增加图片`} title="添加 JPG 或 PNG，每项最多 6 张" disabled={pending || images.length >= MAX_CELL_PICTURES} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--brand-strong)] text-xl text-[var(--brand-strong)] disabled:opacity-40" onClick={() => input.current?.click()}>{pending ? "…" : "＋"}</button> : null}
      {pending ? <span role="status" className="text-xs text-[var(--ink-muted)]">上传中…</span> : images.length >= MAX_CELL_PICTURES ? <span className="text-xs text-[var(--ink-muted)]">已满 6 张</span> : null}
    </div>
    <input ref={input} type="file" accept="image/jpeg,image/png" className="sr-only" aria-label={`${label}选择图片`} disabled={disabled || pending || images.length >= MAX_CELL_PICTURES} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}
  </div>;
}
