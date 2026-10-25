"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { FillColorChips, SuggestColorInput } from "@/components/fill-pack";
import { labels } from "@/lib/labels";
import type { FillColorOption } from "@/server/services/oral-order";

type ColorRow = {
  colorName: string;
  quantity: number;
  sizes: Array<{ sizeCode: string; quantity: number }>;
};

type ExtractPreview = {
  mode: "mock" | "live";
  calledLiveModel: boolean;
  sizes: Array<{
    colorName: string;
    required: number;
    applicable: boolean;
    breakdown: Record<
      string,
      {
        quantity: number | null;
        sourceText: string | null;
        kind: string;
        note: string | null;
      }
    >;
  }>;
  ribSpec: { value: string; sourceText: string | null; kind: string } | null;
  missing: string[];
  conflicts: string[];
  notes: string[];
};

function emptyGrid(colors: ColorRow[], sizeCodes: string[]) {
  const next: Record<string, Record<string, string>> = {};
  for (const color of colors) {
    next[color.colorName] = {};
    for (const code of sizeCodes) {
      const existing = color.sizes.find((size) => size.sizeCode === code);
      next[color.colorName][code] = existing ? String(existing.quantity) : "";
    }
  }
  return next;
}

function toNumber(value: string) {
  if (value.trim() === "") return null;
  const qty = Number(value);
  return Number.isFinite(qty) ? qty : null;
}

export function OrderPrepForm({
  orderId,
  sizeCodes,
  colors,
  expectedUpdatedAt,
  ribSpec,
  deliveryDate,
  deliveryText,
  deliveryYearInference,
  suggestedDeliveryDate,
  canEdit,
  demoNote,
  roleBlocked,
  colorOptions = [],
}: {
  orderId: string;
  sizeCodes: string[];
  colors: ColorRow[];
  expectedUpdatedAt: string;
  ribSpec: string;
  deliveryDate: string;
  deliveryText: string | null;
  deliveryYearInference: string | null;
  suggestedDeliveryDate: string | null;
  canEdit: boolean;
  demoNote: string | null;
  roleBlocked: boolean;
  colorOptions?: FillColorOption[];
}) {
  const router = useRouter();
  const [sizes, setSizes] = useState(() => emptyGrid(colors, sizeCodes));
  const [delivery, setDelivery] = useState(deliveryDate);
  const [rib, setRib] = useState(ribSpec);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<ExtractPreview | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [stamp, setStamp] = useState(expectedUpdatedAt);
  const [extraColors, setExtraColors] = useState<ColorRow[]>([]);
  const [newColorName, setNewColorName] = useState("");
  const [newColorQty, setNewColorQty] = useState("");
  const workingColors = useMemo(() => [...colors, ...extraColors], [colors, extraColors]);

  const totals = useMemo(() => {
    return workingColors.map((color) => {
      const filled = sizeCodes.reduce((sum, code) => sum + (toNumber(sizes[color.colorName]?.[code] ?? "") ?? 0), 0);
      const unknown = sizeCodes.filter((code) => sizes[color.colorName]?.[code]?.trim() === "").length;
      return { ...color, filled, unknown, diff: filled - color.quantity };
    });
  }, [workingColors, sizeCodes, sizes]);
  const orderFilled = totals.reduce((sum, row) => sum + row.filled, 0);
  const orderRequired = workingColors.reduce((sum, row) => sum + row.quantity, 0);

  function addColor() {
    const colorName = newColorName.trim();
    const quantity = Number(newColorQty);
    if (!colorName) {
      setMessage("请先写下新颜色名称");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setMessage("新颜色件数必须是正整数");
      return;
    }
    if (workingColors.some((row) => row.colorName === colorName)) {
      setMessage(`颜色 ${colorName} 已在当前订单中`);
      return;
    }
    setExtraColors((current) => [...current, { colorName, quantity, sizes: [] }]);
    setSizes((current) => ({
      ...current,
      [colorName]: Object.fromEntries(sizeCodes.map((code) => [code, ""])),
    }));
    setNewColorName("");
    setNewColorQty("");
    setMessage("");
  }

  function payload() {
    return {
      expectedUpdatedAt: stamp,
      confirmedDeliveryDate: delivery.trim() || null,
      ribSpec: rib,
      newColors: extraColors.map((color) => ({ colorName: color.colorName, quantity: color.quantity })),
      sizes: workingColors.map((color) => ({
        colorName: color.colorName,
        breakdown: Object.fromEntries(
          sizeCodes
            .map((code) => [code, toNumber(sizes[color.colorName]?.[code] ?? "")] as const)
            .filter(([, qty]) => qty !== null),
        ),
      })),
    };
  }

  async function save(body: unknown) {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/prep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { error?: string; message?: string; updatedAt?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(data.error || "保存失败");
      return false;
    }
    if (data.updatedAt) setStamp(data.updatedAt);
    setMessage(data.message || "资料已保存");
    router.refresh();
    return true;
  }

  async function saveMatrix() {
    await save(payload());
  }

  async function extract() {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/prep/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: paste }),
    });
    const data = (await response.json()) as ExtractPreview & { error?: string };
    setPending(false);
    if (!response.ok) {
      setPreview(null);
      setMessage(data.error || "提取失败");
      return;
    }
    setPreview(data);
  }

  async function confirmExtract() {
    if (!preview) return;
    const next = emptyGrid(workingColors, sizeCodes);
    for (const row of preview.sizes) {
      for (const [code, cell] of Object.entries(row.breakdown)) {
        if (cell.kind === "conflict" || cell.quantity == null) continue;
        if (!next[row.colorName]) continue;
        next[row.colorName][code] = String(cell.quantity);
      }
    }
    setSizes(next);
    if (preview.ribSpec?.value) setRib(preview.ribSpec.value);
    await save({
      expectedUpdatedAt: stamp,
      confirmedDeliveryDate: delivery.trim() || null,
      ribSpec: preview.ribSpec?.value ?? rib,
      sizes: preview.sizes
        .filter((row) => row.applicable)
        .map((row) => ({
          colorName: row.colorName,
          breakdown: Object.fromEntries(
            Object.entries(row.breakdown)
              .filter(([, cell]) => cell.kind !== "conflict" && cell.quantity != null)
              .map(([code, cell]) => [code, cell.quantity]),
          ),
        })),
    });
  }

  if (roleBlocked) {
    return <p className="mt-3 text-sm text-[var(--ink-muted)]">当前角色只能查看，不能改订单资料。</p>;
  }
  if (!canEdit) {
    return <p className="mt-3 text-sm text-[var(--ink-muted)]">该订单已完成或已出运，资料只读，避免覆盖历史。</p>;
  }

  return (
    <div id="size-matrix" className="mt-4 scroll-mt-24 space-y-5">
      {demoNote ? (
        <p className="rounded-md bg-[var(--paper)] px-3 py-2 text-xs text-[var(--ink-muted)]">
          演示数据：{demoNote}。正常订单不会自动套用演示尺码配比，空单元格表示未知，不会按比例填满。
        </p>
      ) : null}

      <section className="space-y-3">
        <h4 className="text-sm font-medium">方式 A · 直接改色尺矩阵</h4>
        <p className="text-xs text-[var(--ink-muted)]">
          颜色来自本订单，尺码来自适用尺码配置。保存的是草稿，不等于批准，也不会因为点保存就解除生产限制。
        </p>
        {workingColors.length === 0 ? (
          <p className="text-sm text-[var(--warning)]">这一单还没有颜色。先写下新颜色和件数，才能补尺码、做分色确认。</p>
        ) : null}
        <FillColorChips
          colors={colorOptions}
          selected={workingColors.map((row) => row.colorName)}
          onPick={(name) => setNewColorName(name)}
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            新颜色
            <div className="mt-1">
              <SuggestColorInput
                id="prep-new-color"
                ariaLabel="新颜色"
                value={newColorName}
                options={colorOptions}
                onChange={setNewColorName}
              />
            </div>
          </label>
          <label className="text-xs">
            件数
            <Input className="mt-1 w-24" inputMode="numeric" value={newColorQty} onChange={(event) => setNewColorQty(event.target.value)} />
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={addColor} disabled={pending}>
            加入颜色
          </Button>
        </div>
        {workingColors.map((color) => {
          const row = totals.find((item) => item.colorName === color.colorName);
          const aligned = row?.filled === color.quantity;
          return (
            <div key={color.colorName}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {color.colorName} · 订单 {color.quantity} 件
                </span>
                <span className={aligned ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
                  已填 {row?.filled ?? 0}
                  {row && row.diff !== 0 ? `，${row.diff > 0 ? "超出" : "尚缺"} ${Math.abs(row.diff)}` : ""}
                  {row && row.unknown > 0 ? `，${row.unknown} 个尺码未知` : ""}
                </span>
              </div>
              <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(sizeCodes.length, 1)}, minmax(0, 1fr))` }}>
                {sizeCodes.map((code) => (
                  <label key={code} className="text-xs">
                    {code}
                    <Input
                      className="mt-1"
                      name={`${color.colorName}-${code}`}
                      inputMode="numeric"
                      placeholder="未知"
                      value={sizes[color.colorName]?.[code] ?? ""}
                      onChange={(event) =>
                        setSizes((current) => ({
                          ...current,
                          [color.colorName]: { ...current[color.colorName], [code]: event.target.value },
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <p className={`text-sm ${orderFilled === orderRequired ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
          订单合计已填 {orderFilled} / 要求 {orderRequired}
        </p>
      </section>

      <section id="delivery-year" className="scroll-mt-24 space-y-2">
        <h4 className="text-sm font-medium">确认交期年份</h4>
        <p className="text-xs text-[var(--ink-muted)]">
          原文{deliveryText ? `「${deliveryText}」` : "未写交期"}。
          {deliveryYearInference ? ` ${deliveryYearInference}` : " 没有推断年份。"}
          确认前不会把推断年写成确认交期。
        </p>
        {suggestedDeliveryDate && !deliveryDate ? (
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              setDelivery(suggestedDeliveryDate);
              await save({ ...payload(), confirmedDeliveryDate: suggestedDeliveryDate });
            }}
            disabled={pending}
          >
            确认交期为 {suggestedDeliveryDate}
          </Button>
        ) : null}
        <label className="block text-sm">
          确认交期（可改年，必须人手确认）
          <Input className="mt-1" name="confirmedDeliveryDate" placeholder="YYYY-MM-DD" value={delivery} onChange={(event) => setDelivery(event.target.value)} />
        </label>
      </section>
      <label className="block text-sm">
        罗纹规格（写入适用草稿，待批准）
        <Input className="mt-1" name="ribSpec" value={rib} onChange={(event) => setRib(event.target.value)} />
      </label>
      <Button type="button" onClick={saveMatrix} disabled={pending}>
        {pending ? "处理中…" : "保存资料草稿"}
      </Button>

      <section className="space-y-3 border-t border-[var(--line)] pt-4">
        <h4 className="text-sm font-medium">方式 B · 粘贴客户补充消息</h4>
        <p className="text-xs text-[var(--ink-muted)]">AI 只展示待确认修改。确认后走与矩阵相同的保存校验。</p>
        <Textarea name="amendmentText" placeholder="把客户补充的色尺或规格消息贴在这里" value={paste} onChange={(event) => setPaste(event.target.value)} />
        <Button type="button" variant="secondary" onClick={extract} disabled={pending || paste.trim().length < 2}>
          提取待确认修改
        </Button>
        {preview ? (
          <div className="space-y-2 rounded-md border border-[var(--line)] p-3 text-sm">
            <p>
              {preview.calledLiveModel ? "已调用真实模型" : "未调用真实模型"}
              {preview.mode === "mock" ? " · 演示提取" : ""}
            </p>
            {preview.notes.map((note) => (
              <p key={note} className="text-xs text-[var(--ink-muted)]">
                {note}
              </p>
            ))}
            {preview.missing.length ? <p>缺失：{preview.missing.join("、")}</p> : null}
            {preview.conflicts.length ? <p className="text-[var(--danger)]">冲突：{preview.conflicts.join("；")}</p> : null}
            {preview.ribSpec ? (
              <p>
                罗纹：{preview.ribSpec.value}（{labels.fieldKind(preview.ribSpec.kind)}
                {preview.ribSpec.sourceText ? ` · ${preview.ribSpec.sourceText}` : ""}）
              </p>
            ) : null}
            {preview.sizes.map((row) => (
              <div key={row.colorName}>
                <p className="font-medium">
                  {row.colorName} · 订单 {row.required} 件
                </p>
                <ul className="mt-1 space-y-1 text-xs">
                  {Object.keys(row.breakdown).length === 0 ? <li>未抽出尺码，保持未知</li> : null}
                  {Object.entries(row.breakdown).map(([code, cell]) => (
                    <li key={code}>
                      {code} {cell.quantity ?? "未知"} · {labels.fieldKind(cell.kind)}
                      {cell.sourceText ? ` · 原文「${cell.sourceText}」` : ""}
                      {cell.note ? ` · ${cell.note}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <Button type="button" onClick={confirmExtract} disabled={pending || preview.conflicts.length > 0}>
              确认写入提取结果
            </Button>
            {preview.conflicts.length > 0 ? <p className="text-xs text-[var(--danger)]">有冲突时请改矩阵后再保存，不会擅自裁决。</p> : null}
          </div>
        ) : null}
      </section>
      {message ? (
        <p className={`text-sm ${/失败|冲突|无权|他人修改/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
