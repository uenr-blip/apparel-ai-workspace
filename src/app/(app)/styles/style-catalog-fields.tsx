"use client";

import { useState } from "react";
import type { StyleCatalog, StyleOptionKind } from "@/server/services/style-catalog";
import { RosterSelect, type RosterOption } from "./roster-select";

export type CatalogPick = {
  brandOptionId: string;
  categoryOptionId: string;
  typeOptionId: string;
  yearOptionId: string;
};

export function StyleCatalogFields({
  catalog,
  value,
  onChange,
  canEdit,
  onCatalogPatch,
}: {
  catalog: StyleCatalog;
  value: CatalogPick;
  onChange: (next: CatalogPick) => void;
  canEdit: boolean;
  onCatalogPatch?: (next: StyleCatalog) => void;
}) {
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  const categoryOptions: RosterOption[] = catalog.categories.flatMap((group) => [
    { id: group.id, name: group.name, group: group.name },
    ...group.children.map((child) => ({ id: child.id, name: child.name, group: group.name })),
  ]);

  async function add(kind: StyleOptionKind, name: string, parentId?: string) {
    if (!canEdit) return;
    setPending(kind);
    setMessage("");
    const response = await fetch("/api/style-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, name, parentId: parentId || null }),
    });
    const body = (await response.json()) as {
      error?: string;
      id?: string;
      name?: string;
      parentId?: string | null;
      parentName?: string | null;
    };
    setPending("");
    if (!response.ok || !body.id || !body.name) {
      setMessage(body.error || "加入失败");
      return;
    }
    if (onCatalogPatch) {
      onCatalogPatch(mergeCatalog(catalog, kind, { id: body.id, name: body.name, parentId: body.parentId ?? null, parentName: body.parentName }));
    }
    if (kind === "brand") onChange({ ...value, brandOptionId: body.id });
    else if (kind === "type") onChange({ ...value, typeOptionId: body.id });
    else if (kind === "year") onChange({ ...value, yearOptionId: body.id });
    else onChange({ ...value, categoryOptionId: body.id });
    setMessage(`已加入 ${body.parentName ? `${body.parentName} / ` : ""}${body.name}`);
  }

  async function remove(id: string) {
    if (!canEdit) return;
    setPending(id);
    setMessage("");
    const response = await fetch(`/api/style-options/${id}`, { method: "DELETE" });
    const body = (await response.json()) as { error?: string; name?: string };
    setPending("");
    if (!response.ok) {
      setMessage(body.error || "撤下失败");
      return;
    }
    if (onCatalogPatch) onCatalogPatch(dropCatalog(catalog, id));
    onChange({
      brandOptionId: value.brandOptionId === id ? "" : value.brandOptionId,
      categoryOptionId: value.categoryOptionId === id ? "" : value.categoryOptionId,
      typeOptionId: value.typeOptionId === id ? "" : value.typeOptionId,
      yearOptionId: value.yearOptionId === id ? "" : value.yearOptionId,
    });
    setMessage(`已从名单撤下 ${body.name ?? ""}`.trim());
  }

  const categoryParentId =
    catalog.categories.find((group) => group.id === value.categoryOptionId)?.id ??
    catalog.categories.find((group) => group.children.some((child) => child.id === value.categoryOptionId))?.id;

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--ink-muted)]">
        品牌、品类、类型、开发年份都可空，在框里下拉选。名单没有的回车加入；不要的点右侧「撤」。有款挂着不能撤，不是删款。年份不是新款号。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <RosterSelect
          label="品牌（可空）"
          value={value.brandOptionId}
          options={catalog.brands}
          placeholder="请选择品牌"
          disabled={!canEdit}
          creating={pending === "brand"}
          removingId={pending}
          onChange={(id) => onChange({ ...value, brandOptionId: id })}
          onCreate={(name) => add("brand", name)}
          onRemove={remove}
        />
        <RosterSelect
          label="品类（可空，分层）"
          value={value.categoryOptionId}
          options={categoryOptions}
          placeholder="请选择品类"
          disabled={!canEdit}
          creating={pending === "category"}
          removingId={pending}
          onChange={(id) => onChange({ ...value, categoryOptionId: id })}
          onCreate={(name) => add("category", name, categoryParentId)}
          onRemove={remove}
        />
        <RosterSelect
          label="类型（可空）"
          value={value.typeOptionId}
          options={catalog.types}
          placeholder="请选择类型"
          disabled={!canEdit}
          creating={pending === "type"}
          removingId={pending}
          onChange={(id) => onChange({ ...value, typeOptionId: id })}
          onCreate={(name) => add("type", name)}
          onRemove={remove}
        />
        <RosterSelect
          label="开发年份（可空，不是款号）"
          value={value.yearOptionId}
          options={catalog.years}
          placeholder="请选择年份"
          disabled={!canEdit}
          creating={pending === "year"}
          removingId={pending}
          onChange={(id) => onChange({ ...value, yearOptionId: id })}
          onCreate={(name) => add("year", name)}
          onRemove={remove}
        />
      </div>
      {message ? (
        <p className={`text-sm ${/失败|无权|已经/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{message}</p>
      ) : null}
    </div>
  );
}

function mergeCatalog(
  catalog: StyleCatalog,
  kind: StyleOptionKind,
  option: { id: string; name: string; parentId: string | null; parentName?: string | null },
): StyleCatalog {
  if (kind === "brand") return { ...catalog, brands: [...catalog.brands, { id: option.id, name: option.name }] };
  if (kind === "type") return { ...catalog, types: [...catalog.types, { id: option.id, name: option.name }] };
  if (kind === "year") return { ...catalog, years: [...catalog.years, { id: option.id, name: option.name }] };
  if (option.parentId) {
    return {
      ...catalog,
      categories: catalog.categories.map((group) =>
        group.id === option.parentId
          ? { ...group, children: [...group.children, { id: option.id, name: option.name }] }
          : group,
      ),
    };
  }
  return { ...catalog, categories: [...catalog.categories, { id: option.id, name: option.name, children: [] }] };
}

function dropCatalog(catalog: StyleCatalog, id: string): StyleCatalog {
  return {
    brands: catalog.brands.filter((item) => item.id !== id),
    types: catalog.types.filter((item) => item.id !== id),
    years: catalog.years.filter((item) => item.id !== id),
    categories: catalog.categories
      .filter((group) => group.id !== id)
      .map((group) => ({ ...group, children: group.children.filter((child) => child.id !== id) })),
  };
}
