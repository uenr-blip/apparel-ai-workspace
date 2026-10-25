"use client";

import { useMemo, useState } from "react";
import { Input, Select } from "@/components/ui/input";
import { labels } from "@/lib/labels";
import type { FillColorOption, FillMaterialOption } from "@/server/services/oral-order";

const SOURCE_LABEL = {
  style: "本款资料",
  org: "组织资料",
  builtin: "常用色",
  bom: "本款 BOM",
} as const;

export function FilterSelect({
  name,
  label,
  value,
  options,
  required,
  emptyLabel,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  required?: boolean;
  emptyLabel?: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? options.filter((item) => item.label.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle))
      : options;
    if (value && !matched.some((item) => item.id === value)) {
      const current = options.find((item) => item.id === value);
      return current ? [current, ...matched] : matched;
    }
    return matched;
  }, [options, query, value]);

  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs text-[var(--ink-muted)]">{label}</span>
      {options.length > 8 ? (
        <Input
          className="mb-2 h-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`筛选${label}`}
          aria-label={`筛选${label}`}
        />
      ) : null}
      <Select name={name} required={required} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {emptyLabel ? <option value="">{emptyLabel}</option> : null}
        {filtered.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function FillColorChips({
  colors,
  selected,
  onPick,
}: {
  colors: FillColorOption[];
  selected: string[];
  onPick: (name: string) => void;
}) {
  if (!colors.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((color) => {
        const active = selected.includes(color.name);
        return (
          <button
            key={`${color.source}-${color.name}`}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(color.name)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              active
                ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]"
                : "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--brand)] hover:text-[var(--ink)]"
            }`}
          >
            {color.name}
            <span className="ml-1 opacity-70">{SOURCE_LABEL[color.source]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FillMaterialChips({
  materials,
  selectedIds,
  onToggle,
}: {
  materials: FillMaterialOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const bom = materials.filter((item) => item.source === "bom");
  const rest = materials
    .filter((item) => item.source === "org" && !/演示材料/.test(item.name))
    .slice(0, 8);
  if (!bom.length && !rest.length) return null;
  return (
    <div className="space-y-2">
      {bom.length ? (
        <div>
          <p className="mb-1 text-xs text-[var(--ink-muted)]">本款已批准资料包 · 点选引用，不是采购</p>
          <div className="flex flex-wrap gap-1.5">
            {bom.map((item) => (
              <MaterialChip key={item.id} item={item} active={selectedIds.includes(item.id)} onToggle={onToggle} />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">这款还没有已批准 BOM，可从组织材料里引用，或到面辅料库建档。</p>
      )}
      {rest.length ? (
        <div>
          <p className="mb-1 text-xs text-[var(--ink-muted)]">组织材料（可手选引用）</p>
          <div className="flex flex-wrap gap-1.5">
            {rest.map((item) => (
              <MaterialChip key={item.id} item={item} active={selectedIds.includes(item.id)} onToggle={onToggle} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MaterialChip({
  item,
  active,
  onToggle,
}: {
  item: FillMaterialOption;
  active: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${item.code} ${item.name}`}
      onClick={() => onToggle(item.id)}
      className={`rounded-full border px-2.5 py-1 text-left text-xs ${
        active
          ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]"
          : "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--brand)] hover:text-[var(--ink)]"
      }`}
    >
      {item.code} {item.name}
      <span className="ml-1 opacity-70">{labels.materialKind(item.kind)}</span>
    </button>
  );
}

export function SuggestColorInput({
  id,
  value,
  options,
  ariaLabel,
  onChange,
}: {
  id: string;
  value: string;
  options: FillColorOption[];
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <Input list={id} aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} placeholder="颜色，可点选或手填" />
      <datalist id={id}>
        {options.map((color) => (
          <option key={`${color.source}-${color.name}`} value={color.name} />
        ))}
      </datalist>
    </>
  );
}
