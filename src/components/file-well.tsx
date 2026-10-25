"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { cn } from "@/lib/cn";
import { AttachmentThumbnail } from "./attachment-thumbnail";

export function FileWell({
  id,
  name = "file",
  accept,
  required,
  label,
  hint,
  compact = false,
  className,
  onFile,
  onClear,
  disabled = false,
}: {
  id?: string;
  name?: string;
  accept?: string;
  required?: boolean;
  label: string;
  hint: string;
  compact?: boolean;
  className?: string;
  onFile?: (file: File) => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [over, setOver] = useState(false);
  const [selected, setSelected] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    function reset() {
      setFileName("");
      setSelected(null);
      setPreview("");
    }
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, []);

  function remember(files: FileList | null) {
    if (disabled) return;
    const file = files?.[0];
    setFileName(file?.name ?? "");
    setSelected(file ?? null);
    setPreview(file ? URL.createObjectURL(file) : "");
    if (file) onFile?.(file);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    const input = inputRef.current;
    if (!file || !input || input.matches(":disabled")) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    remember(transfer.files);
  }

  return (
    <div className={selected ? "file-well-selected" : "min-w-0"}><label
      htmlFor={inputId}
      className={cn("file-well", compact && "file-well-compact", over && "file-well-over", className)}
      onDragEnter={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={name}
        accept={accept}
        required={required}
        disabled={disabled}
        className="file-well-input"
        suppressHydrationWarning
        onChange={(event) => remember(event.target.files)}
      />
      <span className="file-well-plus" aria-hidden>
        +
      </span>
      <span className="file-well-copy">
        <span className="file-well-label">{label}</span>
        <span className="file-well-title">{fileName || "点击选择，或拖到这里"}</span>
        <span className="file-well-hint">{fileName ? "点击更换" : hint}</span>
      </span>
    </label>{selected && preview ? <div className="space-y-1"><AttachmentThumbnail key={preview} href={preview} name={selected.name} mime={selected.type} caption="已选择 · 点击查看" />{(!onFile || onClear) && <button type="button" disabled={disabled} className="text-xs text-[var(--ink-muted)] underline disabled:opacity-40" aria-label={`移除已选文件：${selected.name}`} onClick={() => { if (inputRef.current) inputRef.current.value = ""; setFileName(""); setSelected(null); setPreview(""); onClear?.(); }}>移除文件</button>}</div> : null}</div>
  );
}
