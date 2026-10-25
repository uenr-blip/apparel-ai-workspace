"use client";

import type { SampleElement } from "@/server/domain/merch-sheet";
import { NotedPictures } from "./sheet-picture";

export function SampleElementsEditor({ elements, limit, disabled, onChange }: { elements: SampleElement[]; limit: number; disabled: boolean; onChange: (elements: SampleElement[]) => void }) {
  function patch(id: string, update: Partial<SampleElement>) { onChange(elements.map(e => e.id === id ? { ...e, ...update } : e)); }
  return <>
    {elements.map((element, index) => <NotedPictures key={element.id} label={element.label || `元素 ${index + 1} 内容`} text={element.text} images={element.images} disabled={disabled} onText={text => patch(element.id, { text })} onImages={images => patch(element.id, { images })}
      heading={<div className="flex items-center gap-2"><input aria-label={`元素 ${index + 1} 名称`} value={element.label} maxLength={80} placeholder="元素名称，例如：洗唛、包装袋" disabled={disabled} className="min-w-0 flex-1 bg-transparent text-sm outline-none focus:underline" onChange={e => patch(element.id, { label: e.target.value })} />{!disabled ? <button type="button" className="shrink-0 text-xs text-[var(--ink-muted)]" onClick={() => { if ((!element.label && !element.text && !element.images.length) || window.confirm(`移除“${element.label || "这个元素"}”？保存后会记录这次修改。`)) onChange(elements.filter(e => e.id !== element.id)); }}>移除</button> : null}</div>}
    />)}
    {!disabled ? <div className="md:col-span-2"><button type="button" disabled={elements.length >= limit} className="rounded-lg border border-dashed border-[var(--line)] px-4 py-2 text-sm text-[var(--brand-strong)] disabled:opacity-50" onClick={() => onChange([...elements, { id: crypto.randomUUID(), label: "", text: "", images: [] }])}>＋ 添加元素</button><span className="ml-3 text-xs text-[var(--ink-muted)]">可自定义名称、说明，并点小加号配图</span></div> : null}
  </>;
}
