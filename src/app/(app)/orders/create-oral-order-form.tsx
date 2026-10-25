"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FillColorChips, FillMaterialChips, FilterSelect, SuggestColorInput } from "@/components/fill-pack";
import type { StyleFillPack } from "@/server/services/oral-order";

type Option = { id: string; label: string };

function defaultColors(pack: StyleFillPack | undefined) {
  const named = (pack?.colors ?? []).filter((item) => item.source === "style").slice(0, 2);
  if (named.length) return named.map((item) => ({ colorName: item.name, quantity: "" }));
  return [
    { colorName: "海军蓝", quantity: "" },
    { colorName: "灰色", quantity: "" },
  ];
}

function defaultMaterials(pack: StyleFillPack | undefined) {
  return (pack?.materials ?? []).filter((item) => item.source === "bom").map((item) => item.id);
}

export function CreateOralOrderForm({
  customers,
  styles,
  factories,
  fillPacks,
}: {
  customers: Option[];
  styles: Option[];
  factories: Option[];
  fillPacks: Record<string, StyleFillPack>;
}) {
  const router = useRouter();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [styleId, setStyleId] = useState(styles[0]?.id ?? "");
  const [factoryId, setFactoryId] = useState("");
  const pack = fillPacks[styleId];
  const [colors, setColors] = useState(() => defaultColors(fillPacks[styles[0]?.id ?? ""]));
  const [materialIds, setMaterialIds] = useState(() => defaultMaterials(fillPacks[styles[0]?.id ?? ""]));

  function changeStyle(nextId: string) {
    setStyleId(nextId);
    setMaterialIds(defaultMaterials(fillPacks[nextId]));
    const nextPack = fillPacks[nextId];
    const styleColors = (nextPack?.colors ?? []).filter((item) => item.source === "style").map((item) => item.name);
    if (styleColors.length && colors.every((row) => !row.quantity.trim())) {
      setColors(defaultColors(nextPack));
    }
  }

  function pickColor(name: string) {
    setColors((current) => {
      if (current.some((row) => row.colorName === name)) return current;
      const empty = current.findIndex((row) => !row.colorName.trim());
      if (empty >= 0) return current.map((row, index) => (index === empty ? { ...row, colorName: name } : row));
      return [...current, { colorName: name, quantity: "" }];
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError("");
    const cited = (pack?.materials ?? []).filter((item) => materialIds.includes(item.id));
    const userNote = String(data.get("note") ?? "").trim();
    const citeNote = cited.length
      ? `面辅料引用（资料包，不是采购）：${cited.map((item) => `${item.code} ${item.name}`).join("、")}`
      : "";
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        styleId,
        factoryId: factoryId || null,
        externalCustomerPo: String(data.get("externalCustomerPo") ?? ""),
        deliveryText: String(data.get("deliveryText") ?? ""),
        note: [userNote, citeNote].filter(Boolean).join("。"),
        idempotencyKey,
        colors: colors.map((row) => ({
          colorName: row.colorName,
          quantity: Number(row.quantity),
        })),
      }),
    });
    const body = (await response.json()) as { orderId?: string; error?: string };
    setPending(false);
    if (!response.ok || !body.orderId) {
      setError(body.error || "建单失败");
      return;
    }
    router.push(`/orders/${body.orderId}`);
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm text-[var(--ink-muted)]">
        电话、微信或口头数量从这里建草稿。客户、款号、颜色、面辅料先从已有资料点选，没有的再手填。不复制主档，不下达采购。客户邮件请到
        <Link href="/inbox" className="text-[var(--brand-strong)]">
          客户来单
        </Link>
        粘贴原文后批准。建完仍要在订单页补色尺，不能直接投产。
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect name="customerId" label="客户" value={customerId} options={customers} required onChange={setCustomerId} />
        <FilterSelect name="styleId" label="款号" value={styleId} options={styles} required onChange={changeStyle} />
        <FilterSelect
          name="factoryId"
          label="工厂（可空）"
          value={factoryId}
          options={factories}
          emptyLabel="未指定工厂"
          onChange={setFactoryId}
        />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">客户 PO（可空）</span>
          <Input name="externalCustomerPo" placeholder="没有就留空，不沿用历史 PO" />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">交期原文（可空）</span>
          <Input name="deliveryText" placeholder="例如 10 月 20 日，年份稍后确认" />
        </label>
      </div>
      <div className="space-y-2">
        <p className="text-xs text-[var(--ink-muted)]">颜色件数。优先点本款历史色或常用色，没有的再手填。尺码到订单页再填。</p>
        <FillColorChips colors={pack?.colors ?? []} selected={colors.map((row) => row.colorName)} onPick={pickColor} />
        {colors.map((row, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
            <SuggestColorInput
              id={`oral-color-${index}`}
              ariaLabel={`颜色 ${index + 1}`}
              value={row.colorName}
              options={pack?.colors ?? []}
              onChange={(colorName) => setColors((current) => current.map((item, i) => (i === index ? { ...item, colorName } : item)))}
            />
            <Input
              aria-label={`${row.colorName || "颜色"} 件数`}
              inputMode="numeric"
              value={row.quantity}
              onChange={(event) =>
                setColors((current) => current.map((item, i) => (i === index ? { ...item, quantity: event.target.value } : item)))
              }
              placeholder="件数"
            />
            {colors.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setColors((current) => current.filter((_, i) => i !== index))}
              >
                删除
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => setColors((current) => [...current, { colorName: "", quantity: "" }])}>
          加一色
        </Button>
      </div>
      <FillMaterialChips
        materials={pack?.materials ?? []}
        selectedIds={materialIds}
        onToggle={(id) =>
          setMaterialIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
        }
      />
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-[var(--ink-muted)]">备注（可空）</span>
        <Input name="note" placeholder="例如：微信口头确认，邮件后补" />
      </label>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "正在建草稿…" : "创建口头单草稿"}
      </Button>
    </form>
  );
}
