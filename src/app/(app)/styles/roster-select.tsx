"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type RosterOption = { id: string; name: string; group?: string };

export function RosterSelect({
  label,
  value,
  options,
  placeholder,
  emptyLabel = "未选",
  disabled,
  allowCreate = true,
  creating = false,
  removingId = "",
  onChange,
  onCreate,
  onRemove,
}: {
  label: string;
  value: string;
  options: RosterOption[];
  placeholder: string;
  emptyLabel?: string;
  disabled?: boolean;
  allowCreate?: boolean;
  creating?: boolean;
  removingId?: string;
  onChange: (id: string) => void;
  onCreate?: (name: string) => void | Promise<void>;
  onRemove?: (id: string) => void | Promise<void>;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((item) => item.id === value) ?? null;
  const shown = open ? query : selected?.name ?? "";

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (item) => item.name.toLowerCase().includes(needle) || item.group?.toLowerCase().includes(needle),
    );
  }, [options, query]);

  const exact = options.some((item) => item.name.trim().toLowerCase() === query.trim().toLowerCase());
  const canCreate = Boolean(allowCreate && onCreate && query.trim() && !exact && !disabled);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const groups: Array<{ name: string; items: RosterOption[] }> = [];
  for (const item of filtered) {
    const name = item.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(item);
    else groups.push({ name, items: [item] });
  }

  function pick(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  async function create() {
    const name = query.trim();
    if (!name || !onCreate) return;
    await onCreate(name);
    setQuery("");
    setOpen(false);
  }

  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-[var(--ink-muted)]">{label}</span>
      <div ref={rootRef} className="relative">
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          value={shown}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (canCreate) void create();
              else if (filtered.length === 1) pick(filtered[0]!.id);
            }
          }}
          className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 pr-8 text-sm text-[var(--ink)]"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-[var(--ink-muted)]">▾</span>
        {open ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-50 isolate mt-1 max-h-56 w-full overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--menu-bg)] py-1 text-[var(--ink)] shadow-[var(--shadow-float)]"
          >
            <li>
              <button type="button" className={rowClass(!value)} onMouseDown={(event) => event.preventDefault()} onClick={() => pick("")}>
                {emptyLabel}
              </button>
            </li>
            {groups.map((group) => (
              <li key={group.name || "flat"}>
                {group.name ? <p className="px-3 py-1 text-[11px] text-[var(--ink-muted)]">{group.name}</p> : null}
                {group.items.map((item) => (
                  <div key={item.id} className="flex items-stretch">
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === item.id}
                      className={`${rowClass(value === item.id)} min-w-0 flex-1`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pick(item.id)}
                    >
                      {item.name}
                    </button>
                    {onRemove && !disabled ? (
                      <button
                        type="button"
                        aria-label={`从名单撤下 ${item.name}`}
                        disabled={removingId === item.id || creating}
                        className="shrink-0 bg-[var(--menu-bg)] px-3 text-xs text-[var(--ink-muted)] hover:text-[var(--danger)] disabled:opacity-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void onRemove(item.id)}
                      >
                        {removingId === item.id ? "…" : "撤"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </li>
            ))}
            {filtered.length === 0 && !canCreate ? (
              <li className="px-3 py-2 text-xs text-[var(--ink-muted)]">没有匹配项</li>
            ) : null}
            {canCreate ? (
              <li>
                <button
                  type="button"
                  className={rowClass(false)}
                  disabled={creating}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void create()}
                >
                  {creating ? "加入中…" : `名单没有，回车加入「${query.trim()}」`}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </label>
  );
}

function rowClass(active: boolean) {
  return `block w-full px-3 py-2 text-left text-sm ${
    active ? "bg-[var(--menu-hover)] text-[var(--ink)]" : "bg-[var(--menu-bg)] text-[var(--ink)] hover:bg-[var(--menu-hover)]"
  }`;
}
