"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { PatternChoice } from "@/lib/pattern-choices";

export function EditableChoice({ label, value, options, onChange, onRemove, disabled, price = false }: {
  label: string; value: string; options: PatternChoice[]; onChange: (value: string) => void; onRemove?: (choice: PatternChoice) => void; disabled?: boolean; price?: boolean;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [active, setActive] = useState(-1), [above, setAbove] = useState(false);
  const matched = options.filter(row => !row.hidden && `${row.value} ${row.source} ${row.detail ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const shown = matched.slice(0, 50);
  function show() {
    const rect = input.current?.getBoundingClientRect();
    setAbove(Boolean(rect && window.innerHeight - rect.bottom < 280 && rect.top > 280));
    setQuery(""); setActive(-1); setOpen(true);
  }
  function choose(text: string) { onChange(text); setOpen(false); setActive(-1); }
  return <div className="min-w-0 text-sm" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); }
  }}>
    <label htmlFor={`${id}-input`}>{label}</label>
    <div className="relative mt-1">
      <input ref={input} id={`${id}-input`} aria-label={label} role="combobox" aria-haspopup="grid" aria-expanded={open && !disabled}
        aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
        autoComplete="off" maxLength={400} disabled={disabled} value={value} placeholder="点击选择，也可直接输入"
        className={`w-full rounded-lg border border-[var(--line)] bg-[var(--field-solid)] py-2 pl-3 text-sm ${value ? "pr-20" : "pr-10"}`}
        onFocus={() => { if (!open) show(); }} onClick={() => { if (!open) show(); }}
        onChange={event => { onChange(event.target.value); setQuery(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); } setOpen(false); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); if (!open) { show(); return; }
            const next = event.key === "ArrowDown" ? Math.min(active + 1, shown.length - 1) : Math.max(active - 1, 0);
            setActive(shown.length ? next : -1);
            document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: "nearest" });
          }
          if (event.key === "Enter" && open) { event.preventDefault(); if (active >= 0 && shown[active]) choose(shown[active].value); else setOpen(false); }
        }} />
      {value && <button type="button" aria-label={`清空${label}`} title="清空本次填写，保存后生效" disabled={disabled} className="absolute inset-y-0 right-10 flex w-9 items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-40" onClick={() => { onChange(""); setQuery(""); setActive(-1); setOpen(false); }}><X size={15} aria-hidden="true"/></button>}
      <button type="button" aria-label={`选择${label}`} aria-expanded={open && !disabled} aria-controls={`${id}-list`} disabled={disabled}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-[var(--ink-muted)] hover:text-[var(--ink)]"
        onClick={() => { if (open) setOpen(false); else { input.current?.focus(); show(); } }}><ChevronDown size={16} aria-hidden="true" /></button>
      {open && !disabled ? <div className={`absolute z-50 w-full overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[var(--menu-bg)] text-[var(--ink)] shadow-[var(--shadow-float)] ${above ? "bottom-full mb-1" : "top-full mt-1"}`}>
        <div id={`${id}-list`} role="grid" aria-label={`${label}候选`} className="max-h-52 overflow-y-auto overscroll-contain">
          {shown.map((row, index) => <div key={`${row.value}-${row.supplier ?? ""}-${index}`} role="row" className={`flex items-center ${active === index ? "bg-[var(--menu-hover)]" : "hover:bg-[var(--menu-hover)]"}`}>
            <div role="gridcell" id={`${id}-option-${index}`} aria-selected={active === index} className="min-w-0 flex-1">
              <button type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(row.value)} className="block w-full px-3 py-2 text-left">
                <span className="block break-words">{row.value}</span>
                <span className="block break-words text-xs text-[var(--ink-muted)]">{row.source}{row.detail ? ` · ${row.detail}` : ""}</span>
              </button>
            </div>
            {onRemove && <div role="gridcell" className="shrink-0 pr-2"><button type="button" aria-label={`删除候选：${row.value}`} title="从我的候选中删除，保存后生效" className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--field-solid)] hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-strong)]" onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus(); onRemove(row); setActive(-1); }}><X size={14} aria-hidden="true"/></button></div>}
          </div>)}
        </div>
        {!shown.length && <p className="px-3 py-3 text-xs text-[var(--ink-muted)]">{price ? "暂无对应供应商的历史填写，可直接输入。" : "没有匹配项，可直接输入。"}</p>}
        {(price || matched.length > 50) && <p className="border-t border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-muted)]">{matched.length > 50 ? "先显示50项，输入文字可筛选。" : ""}{price ? "历史填写供参考，须核对币种、单位及本次条件。" : ""}</p>}
      </div> : null}
    </div>
  </div>;
}
