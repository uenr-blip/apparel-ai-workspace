"use client";

import { TablePhoto } from "@/components/table-photo";
import { useRef, useState, type ReactNode } from "react";
import { FileWell } from "@/components/file-well";
import type { CellPictureKey } from "@/server/domain/merch-sheet";

export async function uploadSheetImage(file: File) {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/sheet-images", { method: "POST", body });
  const payload = (await response.json()) as { error?: string; imageSrc?: string };
  if (!response.ok || !payload.imageSrc) throw new Error(payload.error || "图片没有传上");
  return payload.imageSrc;
}

export function SheetPicture({
  label,
  imageSrc,
  compact = false,
  disabled,
  onChange,
}: {
  label: string;
  imageSrc: string;
  compact?: boolean;
  disabled: boolean;
  onChange: (imageSrc: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function upload(file: File) {
    setPending(true);
    setError("");
    try {
      onChange(await uploadSheetImage(file));
    } catch (error) {
      setError(error instanceof Error ? error.message : "图片没有传上");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">{label}</p>
      {imageSrc ? (
        <div className="flex items-end gap-2"><TablePhoto src={imageSrc} label={label}/>{!disabled && <button type="button" disabled={pending} aria-label={`移除${label}`} className="text-xs text-[var(--ink-muted)] underline disabled:opacity-40" onClick={() => onChange("")}>移除图片</button>}</div>
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">还没有图</p>
      )}
      {disabled ? null : (
        <FileWell key={imageSrc} disabled={pending} compact={compact} label={pending ? "正在上传…" : compact ? "上传款式图" : "上传 JPG 或 PNG"} hint="这是这一张上的图，不是采购。" accept="image/jpeg,image/png" onFile={(file) => void upload(file)} onClear={() => setError("")} />
      )}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

export const NOTED_PICTURES: Array<{ key: CellPictureKey; label: string }> = [
  { key: "metalBadge", label: "金属标" },
  { key: "liningColor", label: "里布颜色" },
  { key: "mainLabel", label: "主唛" },
  { key: "hangtag", label: "挂牌" },
  { key: "note", label: "备注" },
];

export function NotedPictures({
  label,
  heading,
  text,
  images,
  disabled,
  onText,
  onImages,
}: {
  label: string;
  heading?: ReactNode;
  text: string;
  images: string[];
  disabled: boolean;
  onText: (value: string) => void;
  onImages: (images: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function upload(file: File) {
    setPending(true);
    setError("");
    try {
      onImages([...images, await uploadSheetImage(file)].slice(0, 6));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片没有传上");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative self-start rounded-xl border border-[var(--line)] p-3">
      <div className="text-sm">
        {heading ?? label}
        <div className="mt-1 flex items-center gap-2">
          <input
            className="w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2 text-sm"
            value={text}
            disabled={disabled}
            aria-label={label}
            onChange={(event) => onText(event.target.value)}
          />
          {disabled ? null : (
            <button
              type="button"
              className="file-well-plus shrink-0"
              aria-label={`${label}贴图`}
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              {pending ? "…" : "+"}
            </button>
          )}
        </div>
      </div>
      {images.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((src) => (
            <div key={src} className="relative">
              <TablePhoto src={src} label={label}/>
              {disabled ? null : (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`移除${label}图片 ${images.indexOf(src) + 1}`}
                  className="absolute right-1 top-1 rounded bg-[var(--surface-solid)] px-1 text-xs"
                  onClick={() => onImages(images.filter((item) => item !== src))}
                >
                  移除
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {disabled ? null : (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          aria-label={`${label}选择图片`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      )}
      {error ? <p className="mt-1 text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

export function CellThumbs({ images, label }: { images: string[]; label: string }) {
  if (!images.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {images.map((src) => (
        <TablePhoto key={src} src={src} label={label} compact />
      ))}
    </div>
  );
}
