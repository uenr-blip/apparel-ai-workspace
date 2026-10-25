"use client";

import Link from "next/link";
import { MAX_SAMPLE_ELEMENTS, bulkPieceCount } from "@/server/domain/merch-sheet";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CRAFT_LABEL, type CraftFamily } from "@/server/domain/craft-sheet";
import { emptyBulk, emptyLabDip, emptySalesSample, type BulkColor, type BulkSheet, type BulkPictureKey, type CellPictureKey, type DipColor, type LabDip, type MerchStyle, type PurchaseLine, type SalesSample } from "@/server/domain/merch-sheet";
import { NotedPictures, NOTED_PICTURES, SheetPicture } from "./sheet-picture";
import { CellImageEditor } from "./cell-image-editor";
import { BulkLabelEditor } from "./bulk-label-editor";
import { SampleElementsEditor } from "./sample-elements-editor";
import { useFollowEditState } from "./follow-edit-state";
import type { StyleSheetLink } from "@/server/services/order-merch";

const fieldClass =
  "mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2 text-sm";

function TrimBox({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${value ? Math.min(Math.max(el.scrollHeight, 32), 112) : 32}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className="block max-h-28 min-h-8 w-full resize-y overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-2 py-1"
      value={value}
      disabled={disabled}
      aria-label={label}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  type?: "text" | "date";
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input type={type} placeholder={placeholder} className={fieldClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

const guestLabel: Record<DipColor["guest"], string> = {
  "": "还没送",
  pending: "等客人确认",
  yes: "客人确认了",
  no: "客人没过",
};

function DipBlock({
  dip,
  disabled,
  onChange,
  onPull,
}: {
  dip: LabDip;
  disabled: boolean;
  onChange: (next: LabDip) => void;
  onPull: () => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-medium">打色</h3>
      <p className="text-sm leading-6 text-[var(--ink-muted)]">一块面料有好几个颜色，每个颜色都要客人确认。辅料也要确认色。</p>
      {disabled ? null : (
        <button type="button" className="text-sm text-[var(--brand-strong)]" onClick={onPull}>
          按这一款已写的颜色带出
        </button>
      )}
      <div className="overflow-x-auto">
        <table className="sheet-table min-w-[520px] text-sm">
          <thead>
            <tr>
              <th>面料颜色</th>
              <th>客人</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {dip.fabricColors.length === 0 ? (
              <tr>
                <td colSpan={3}>还没有颜色。先写下颜色，或按已写颜色带出。</td>
              </tr>
            ) : null}
            {dip.fabricColors.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td>
                  <input
                    className="w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-2 py-1"
                    value={row.name}
                    disabled={disabled}
                    onChange={(event) => onChange({
                      ...dip,
                      fabricColors: dip.fabricColors.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item),
                    })}
                  />
                </td>
                <td>
                  <select
                    className="w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-2 py-1"
                    value={row.guest}
                    disabled={disabled}
                    onChange={(event) => onChange({
                      ...dip,
                      fabricColors: dip.fabricColors.map((item, itemIndex) => itemIndex === index ? { ...item, guest: event.target.value as DipColor["guest"] } : item),
                    })}
                  >
                    {(Object.keys(guestLabel) as DipColor["guest"][]).map((mark) => (
                      <option key={mark || "empty"} value={mark}>{guestLabel[mark]}</option>
                    ))}
                  </select>
                </td>
                <td>{!disabled && !row.guest ? <button type="button" className="whitespace-nowrap text-xs text-[var(--ink-muted)] underline" aria-label={`移除打色 ${index + 1}`} onClick={() => onChange({ ...dip,fabricColors:dip.fabricColors.filter((_,i)=>i!==index) })}>移除</button> : <span className="text-xs text-[var(--ink-muted)]">保留确认记录</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {disabled ? null : (
        <button
          type="button"
          className="text-sm text-[var(--brand-strong)]"
          onClick={() => onChange({ ...dip, fabricColors: [...dip.fabricColors, { name: "", guest: "" }] })}
        >
          再加一个面料颜色
        </button>
      )}
      <div className="overflow-x-auto">
        <table className="sheet-table min-w-[520px] text-sm">
          <thead>
            <tr>
              <th>辅料</th>
              <th>客人确认色</th>
            </tr>
          </thead>
          <tbody>
            {dip.trimColors.map((row, index) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>
                  <select
                    className="w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-2 py-1"
                    value={row.guest}
                    disabled={disabled}
                    onChange={(event) => onChange({
                      ...dip,
                      trimColors: dip.trimColors.map((item, itemIndex) => itemIndex === index ? { ...item, guest: event.target.value as DipColor["guest"] } : item),
                    })}
                  >
                    {(Object.keys(guestLabel) as DipColor["guest"][]).map((mark) => (
                      <option key={mark || "empty"} value={mark}>{guestLabel[mark]}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const blankColor = (): BulkColor => ({ guestColor: "", factoryColorName: "", qtyText: "", metalBadge: "" });

type StyleDraft = MerchStyle & { colors: BulkColor[] };

function toDraft(style: MerchStyle): StyleDraft {
  return { ...style, colors: style.bulk.colors.length ? style.bulk.colors : [blankColor()] };
}

function blankStyle(): StyleDraft {
  return toDraft({
    styleCode: "",
    styleName: "",
    craftFamily: "",
    imagePath: "",
    labDip: emptyLabDip(),
    salesSample: emptySalesSample(),
    bulk: emptyBulk(),
  });
}

export function MerchSheetForm({
  orderId,
  savePath,
  kind = "",
  factoryName: initialFactory = "",
  customerId: initialCustomerId = "",
  partners,
  expectedUpdatedAt,
  seasonCode,
  styles: initialStyles,
  styleChoices,
  purchases,
  canEdit: allowedEdit,
  batchLocked = false,
  lockedRowIds = [],
  materialRowIds = [],
  shipments = [],
  initialStyle = 0,
  relatedByCode = {},
  materialsSection,
  materialsRowId,
  styleImages = {},
}: {
  materialsSection?: ReactNode;
  materialsRowId?: string;
  styleImages?: Record<string, string>;
  orderId: string;
  savePath?: string;
  kind?: "" | "sales_sample" | "bulk";
  factoryName?: string;
  customerId?: string;
  partners?: { factories: Array<{ id: string; name: string }>; customers: Array<{ id: string; name: string }> };
  expectedUpdatedAt: string;
  seasonCode: string;
  styles: MerchStyle[];
  styleChoices: Array<{ code: string; name: string; productCode?: string }>;
  purchases: Array<PurchaseLine & { styleCode: string }>;
  canEdit: boolean;
  batchLocked?: boolean;
  lockedRowIds?: string[];
  materialRowIds?: string[];
  initialStyle?: number;
  shipments?: Array<{ po: string; dates: string[] }>;
  relatedByCode?: Record<string, StyleSheetLink[]>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [imageUploads, setImageUploads] = useState(0);
  const imageUploadCount = useRef(0);
  function onUploadChange(delta: number) { imageUploadCount.current += delta; setImageUploads(imageUploadCount.current); }
  const canEdit = allowedEdit && !pending;
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"ok" | "danger">("ok");
  const [stamp, setStamp] = useState(expectedUpdatedAt);
  const [season, setSeason] = useState(seasonCode);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [factoryName, setFactoryName] = useState(initialFactory);
  const [styles, setStyles] = useState<StyleDraft[]>(initialStyles.length ? initialStyles.map(toDraft) : [blankStyle()]);
  const [open, setOpen] = useState(initialStyle);
  const [priorInitialStyle, setPriorInitialStyle] = useState(initialStyle);
  if (priorInitialStyle !== initialStyle) { setPriorInitialStyle(initialStyle); setOpen(initialStyle); }
  const editing = useFollowEditState();
  const draftSignature = JSON.stringify({ season, factoryName, customerId, styles });
  const [savedSignature, setSavedSignature] = useState(draftSignature);
  useEffect(() => { editing?.setDirty(imageUploads > 0 || draftSignature !== savedSignature); }, [draftSignature, savedSignature, editing, imageUploads]);
  const [incomingStamp, setIncomingStamp] = useState(expectedUpdatedAt);
  if (!pending && !imageUploads && draftSignature === savedSignature && incomingStamp !== expectedUpdatedAt) {
    setIncomingStamp(expectedUpdatedAt); setStamp(expectedUpdatedAt);
    const nextStyles = initialStyles.length ? initialStyles.map(toDraft) : [blankStyle()];
    setStyles(nextStyles); setSeason(seasonCode); setFactoryName(initialFactory); setCustomerId(initialCustomerId);
    setSavedSignature(JSON.stringify({ season: seasonCode, factoryName: initialFactory, customerId: initialCustomerId, styles: nextStyles }));
  }
  const current = styles[open] ?? styles[0];
  const unifiedMaterials = Boolean(current?.rowId && materialRowIds.includes(current.rowId));
  const currentLocked = batchLocked || Boolean(current?.rowId && lockedRowIds.includes(current.rowId));
  const savedColorCount = (initialStyles.find(row => row.rowId && row.rowId === current?.rowId)?.bulk.colors ?? []).length;
  const currentLinks = relatedByCode[current?.styleCode.trim().toUpperCase() ?? ""] ?? [];
  const family = current?.craftFamily ?? "";
  const sample = current?.salesSample ?? emptySalesSample();
  const bulkDraft = current?.bulk ?? emptyBulk();
  const colors = current?.colors ?? [blankColor()];

  function updateOpen(patch: Partial<StyleDraft> | ((style: StyleDraft) => Partial<StyleDraft>)) {
    setStyles((current) =>
      current.map((row, index) => {
        if (index !== open) return row;
        const next = typeof patch === "function" ? patch(row) : patch;
        return { ...row, ...next };
      }),
    );
  }
  function setFamily(value: CraftFamily | "") {
    updateOpen({ craftFamily: value });
  }
  function patchSample(key: keyof SalesSample, value: string) {
    updateOpen((style) => ({ salesSample: { ...style.salesSample, [key]: value } }));
  }

  function patchPictures(key: CellPictureKey, images: string[]) {
    updateOpen((style) => ({
      salesSample: { ...style.salesSample, pictures: { ...style.salesSample.pictures, [key]: images } },
    }));
  }
  function patchBulk(key: keyof Omit<BulkSheet, "colors">, value: string) {
    updateOpen((style) => ({ bulk: { ...style.bulk, [key]: value } }));
  }
  function patchBulkPictures(key: BulkPictureKey, images: string[]) {
    updateOpen(style => ({ bulk: { ...style.bulk, pictures: { ...style.bulk.pictures, [key]: images } } }));
  }
  function patchColor(index: number, key: keyof BulkColor, value: string) {
    updateOpen((style) => ({
      colors: style.colors.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    }));
  }
  function setDip(next: LabDip) {
    updateOpen({ labDip: next });
  }
  const dip = current?.labDip ?? emptyLabDip();

  async function save() {
    if (editing?.stageEditing) { setMessage("请先完成或取消上方用料与交接操作，再保存跟单"); return; }
    if (imageUploadCount.current > 0) { setMessage("图片正在上传，请稍候再保存。"); return; }
    setPending(true);
    setMessage("");
    try {
    const response = await fetch(savePath ?? `/api/orders/${orderId}/merch-sheet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: stamp,
        idempotencyKey: crypto.randomUUID(),
        seasonCode: season,
        factoryName,
        ...(partners ? { customerId: customerId || null, factoryId: partners.factories.find(f=>f.name===factoryName)?.id ?? null } : {}),
        styles: styles.map((style) => ({
          rowId: style.rowId,
          styleCode: style.styleCode,
          styleName: style.styleName,
          craftFamily: style.craftFamily,
          imagePath: style.imagePath,
          labDip: style.labDip,
          salesSample: style.salesSample,
          bulk: { ...style.bulk, colors: style.colors },
        })),
      }),
    });
    const body = (await response.json()) as { error?: string; message?: string; expectedUpdatedAt?: string; styles?: MerchStyle[] };
    setPending(false);
    if (!response.ok) {
      setTone("danger");
      setMessage(body.error || "保存失败");
      return;
    }
    const persisted = body.styles?.map(toDraft);
    if (persisted) setStyles(persisted);
    setSavedSignature(persisted ? JSON.stringify({ season, factoryName, customerId, styles: persisted }) : draftSignature);
    editing?.setDirty(false);
    if (body.expectedUpdatedAt) { setStamp(body.expectedUpdatedAt); editing?.saved(body.expectedUpdatedAt); }
    setTone("ok");
    setMessage(body.message || "已保存");
    router.refresh();
    } catch {
      setTone("danger");
      setMessage("连接中断，填写内容已保留，请重新保存并核对结果。");
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-5">
      <section id="follow-product" className="scroll-mt-24 space-y-4">
        <h2 className="font-semibold">{current?.styleName || current?.styleCode || "本款资料"} · 基础信息</h2>
        <div className="grid items-start gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
          <div>      <SheetPicture
        label="款式图"
        compact
        imageSrc={current?.imagePath || styleImages[current?.rowId || ""] || ""}
        disabled={!canEdit}
        onChange={(imageSrc) => updateOpen({ imagePath: imageSrc })}
      />
</div><div className="space-y-3">      <div className="scroll-mt-24 grid gap-3 md:grid-cols-2">
        <Field label="产品编号" value={sample.numericCode} disabled={!canEdit || currentLocked} onChange={(value) => patchSample("numericCode", value)} />
        <Field label="款号" value={current?.styleCode ?? ""} disabled={!canEdit || currentLocked} onChange={(value) => updateOpen({ styleCode: value })} />
        <Field label="品名（可填英文品名）" value={current?.styleName ?? ""} disabled={!canEdit} onChange={(value) => updateOpen({ styleName: value })} />
        <label className="block text-sm">
          毛衣 / 针织 / 梭织
          <select className={fieldClass} value={family} disabled={!canEdit} onChange={(event) => setFamily(event.target.value as CraftFamily | "")}>
            <option value="">还没分</option>
            {(Object.keys(CRAFT_LABEL) as CraftFamily[]).map((item) => (
              <option key={item} value={item}>
                {CRAFT_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div id="follow-batch" className="scroll-mt-24 grid gap-3 md:grid-cols-2">
        {kind === "sales_sample" ? <Field label="订单号（PO）" value={sample.po} disabled={!canEdit || currentLocked} onChange={(value) => patchSample("po", value)} /> : <><Field label="订单号（PO）" value={bulkDraft.po} disabled={!canEdit || currentLocked} onChange={(value) => patchBulk("po", value)} />
<Field label="客户采购日期" placeholder="YYYY-MM-DD，例如 2026-09-09" value={bulkDraft.purchaseDate} disabled={!canEdit || currentLocked} onChange={(value) => patchBulk("purchaseDate", value)} />
<Field label="进仓日期" value={bulkDraft.inboundDate} disabled={!canEdit} onChange={(value) => patchBulk("inboundDate", value)} />
<Field label="要求出货日期（计划）" placeholder="YYYY-MM-DD；旧记录请补齐年份" value={bulkDraft.shipDate} disabled={!canEdit || currentLocked} onChange={(value) => patchBulk("shipDate", value)} /></>}
      </div>
      <Field label="季节" value={season} disabled={!canEdit} onChange={setSeason} />
      {partners ? <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">客户<select className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] p-2" disabled={!canEdit || batchLocked || lockedRowIds.length > 0} value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">待确认</option>{partners.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{kind === "bulk" ? <label className="text-sm">工厂<select className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] p-2" disabled={!canEdit || batchLocked || lockedRowIds.length > 0} value={factoryName} onChange={e=>setFactoryName(e.target.value)}><option value="">请选择工厂</option>{factoryName && !partners.factories.some(f=>f.name===factoryName)?<option value={factoryName}>{factoryName}（旧记录，待核对主档）</option>:null}{partners.factories.map(f=><option key={f.id} value={f.name}>{f.name}</option>)}</select></label> : null}</div> : kind === "bulk" ? <Field label="工厂" value={factoryName} disabled={!canEdit || batchLocked || lockedRowIds.length > 0} onChange={setFactoryName} /> : null}
</div>
        </div>
        <p className="text-xs text-[var(--ink-muted)]">产品编号识别同一产品；客户 PO 区分下单批次，翻单沿用产品编号。未保存的基础信息请先保存，再修改用料或开单。</p>
        {allowedEdit ? <Button type="button" onClick={save} disabled={pending || imageUploads > 0 || editing?.stageEditing}>保存本表改动</Button> : null}
        {message ? <p role="status" className={tone === "ok" ? "text-sm text-[var(--ok)]" : "text-sm text-[var(--danger)]"}>{message}</p> : null}
      </section>
      <details className="rounded-lg border border-[var(--line)] p-3"><summary className="cursor-pointer text-sm">本表共 {styles.length} 款 · 切换 / 添加款式</summary><div className="mt-3 space-y-3">
      <div className="overflow-x-auto">
        <table className="sheet-table min-w-[720px] text-sm">
          <thead>
            <tr>
              <th>订单号（PO）</th>
              <th>产品编号</th>
              {kind !== "sales_sample" ? <th>客户采购日期</th> : null}
              <th>款号</th>
              <th>款名</th>
                <th>类型</th>
                <th>{kind === "sales_sample" ? "颜色 / 销售样数量" : "颜色 / 客户采购数量（件）"}</th>
                {kind !== "sales_sample" ? <><th>合计（件）</th><th>要求出货日期</th><th>出运登记日期</th></> : null}
                <th></th>
            </tr>
          </thead>
          <tbody>
            {styles.map((style, index) => (
              <tr key={index} className={index === open ? "bg-[var(--nav-active-bg)]" : ""}>
                <td>{(kind === "sales_sample" ? style.salesSample.po : style.bulk.po) || "待补"}</td>
                <td>{style.salesSample.numericCode || "待补"}</td>
                {kind !== "sales_sample" ? <td>{style.bulk.purchaseDate || "待补"}</td> : null}
                <td>
                  <div>{style.styleCode || "未写款号"}</div>
                  {(relatedByCode[style.styleCode.trim().toUpperCase()] ?? []).map((link) => (
                    <Link key={`${link.href}:${link.label}`} href={link.href} className="mt-1 block text-xs text-[var(--brand-strong)]">
                      {link.label}
                    </Link>
                  ))}
                </td>
                <td>{style.styleName || "未写款名"}</td>
                <td>{style.craftFamily ? CRAFT_LABEL[style.craftFamily] : "还没分"}</td>
                <td>
                  {kind === "sales_sample" ? `${style.salesSample.colors || "颜色待补"} · 销售样 ${style.salesSample.salesSample || "数量待补"}` : style.colors.filter((row) => row.guestColor || row.qtyText).map((row) => `${row.guestColor || "未写颜色"} ${row.qtyText || "件数空着"}`).join("、") || "还没写颜色"}
                </td>
                {kind !== "sales_sample" ? <><td>{bulkPieceCount({ ...style.bulk, colors: style.colors }).count ?? "待补"}{bulkPieceCount({ ...style.bulk, colors: style.colors }).unreadable ? "（部分数量待核对）" : ""}</td><td>{style.bulk.shipDate || "待补"}</td><td>{shipments.find(item => item.po.toUpperCase() === style.bulk.po.toUpperCase() && item.po)?.dates.join("、") || "暂无可归属此 PO 的登记"}</td></> : null}
                <td>
                  <button type="button" className="text-[var(--brand-strong)]" disabled={imageUploads > 0} onClick={() => {
                    if (savePath?.startsWith("/api/orders/follow") && style.rowId) {
                      if (draftSignature !== savedSignature || editing?.stageEditing) { setMessage("请先保存当前改动，再切换款式用料"); return; }
                      router.push(`/orders/follow/${orderId}?row=${index}#follow-product`); setOpen(index);
                    } else setOpen(index);
                  }}>
                    {index === open ? "正在改" : "改这一款"}
                  </button>
                  {canEdit && !batchLocked && !style.rowId ? <button type="button" disabled={imageUploads > 0 || editing?.stageEditing} className="ml-3 whitespace-nowrap text-xs text-[var(--ink-muted)] underline" aria-label={`取消新增款 ${index + 1}`} onClick={() => { const next=styles.filter((_,i)=>i!==index);setStyles(next.length?next:[blankStyle()]);setOpen(Math.max(0,open>index?open-1:Math.min(open,next.length-1))); }}>取消新增</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && !batchLocked && !imageUploads ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            从已有款带出
            <select
              className={fieldClass}
              defaultValue=""
              onChange={(event) => {
                const choice = styleChoices.find((item) => item.code === event.target.value);
                if (!choice) return;
                setStyles([...styles, toDraft({ ...blankStyle(), styleCode: choice.code, styleName: choice.name, bulk: emptyBulk(), salesSample: { ...emptySalesSample(), numericCode: choice.productCode ?? "" }, craftFamily: "" })]);
                setOpen(styles.length);
                event.target.value = "";
              }}
            >
              <option value="">选择款号</option>
              {styleChoices.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="text-sm text-[var(--brand-strong)]"
            onClick={() => {
              setStyles([...styles, blankStyle()]);
              setOpen(styles.length);
            }}
          >
            加一个还没建档的款
          </button>
        </div>
      ) : null}
      {currentLinks.length ? (
        <p className="text-sm">
          同一款在另一张跟单：
          {currentLinks.map((link) => (
            <Link key={`${link.href}:${link.label}`} href={link.href} className="ml-3 text-[var(--brand-strong)]">
              {link.label}
            </Link>
          ))}
        </p>
      ) : null}
      </div></details>
      {materialsSection && current?.rowId === materialsRowId ? materialsSection : savePath?.startsWith("/api/orders/follow") && !current?.rowId ? <p className="text-sm text-[var(--ink-muted)]">请先保存新增款式，再填写本款面料、纱线、辅料与工艺。</p> : null}
      <details className="text-sm"><summary className="cursor-pointer text-[var(--ink-muted)]">填写说明</summary><div className="mt-2 space-y-2">      <p className="text-sm leading-6">
        {kind === "bulk"
          ? "这一张是这家工厂的大货。颜色写「不下」就是这个颜色不做。同一款号可以点到销售样。大货件数在这里写，不从销售样抄过来。这里不算采购单，也不付款。"
          : kind === "sales_sample"
            ? "这一张是销售样。每款大约二十几件，先看卖得怎么样。同一款号可以点到大货。这里不算采购单，也不付款。"
            : "这一单可以放很多款。先在下面点一款再改它的销售样和大货。颜色写「不下」就是这个颜色大货不做。这里不算采购单，也不付款。"}
      </p>
      <p className="text-xs text-[var(--ink-muted)]">填写口径：空白表示尚未填写；“待确认”表示已知要核对；确认不用的材料或辅料写“不需要”。颜色不做写“不下”，数量不猜补。</p>
</div></details>
      <p className="text-sm text-[var(--ink-muted)]">订单号就是客户 PO；产品编号是产品固定标识，翻单沿用。采购日期按客户 PO 原单填写。{currentLocked ? "本款已转生产，批次修改请记录客户改单；进度仍可补充。其余未转出的款可以继续补齐。" : ""}</p>
      {kind === "bulk" ? null : (
      <div id="follow-sample-labels" className="scroll-mt-24 mt-4 grid gap-3 md:grid-cols-2">
        <h3 className="font-medium md:col-span-2">销售样唛标、辅料与图文说明</h3>
        {NOTED_PICTURES.map((item) => (
          <NotedPictures
            key={item.key}
            label={item.label}
            text={sample[item.key]}
            images={sample.pictures[item.key]}
            disabled={!canEdit}
            onText={(value) => patchSample(item.key, value)}
            onImages={(images) => patchPictures(item.key, images)}
          />
        ))}
        <SampleElementsEditor elements={sample.elements || []} limit={MAX_SAMPLE_ELEMENTS} disabled={!canEdit} onChange={elements => updateOpen(style => ({ salesSample: { ...style.salesSample, elements } }))} />
      </div>
      )}
      {kind === "bulk" ? null : (
      <div>
        <h3 id="follow-sample" className="scroll-mt-24 font-medium">销售样数量、报价与原表资料</h3>{unifiedMaterials ? <p className="mt-2 text-xs text-[var(--ink-muted)]">面料、纱线、辅料与工艺以<a className="underline" href="#stage-materials">上方本阶段详情</a>为准；下方原表面料摘要保留供对照。</p> : null}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="工厂" value={sample.factoryName} disabled={!canEdit} onChange={(value) => patchSample("factoryName", value)} />
          <Field label="面料颜色意见" value={sample.colorOpinion} disabled={!canEdit} onChange={(value) => patchSample("colorOpinion", value)} />
          <Field label="克重" value={sample.gsm} disabled={!canEdit || unifiedMaterials} onChange={(value) => patchSample("gsm", value)} />
          <Field label="面布成分" value={sample.composition} disabled={!canEdit || unifiedMaterials} onChange={(value) => patchSample("composition", value)} />
          <Field label="颜色" value={sample.colors} disabled={!canEdit} onChange={(value) => patchSample("colors", value)} />
          <Field label="面料门幅" value={sample.shellWidth} disabled={!canEdit || unifiedMaterials} onChange={(value) => patchSample("shellWidth", value)} />
          <Field label="面料单耗" value={sample.shellConsumption} disabled={!canEdit || unifiedMaterials} onChange={(value) => patchSample("shellConsumption", value)} />
          <Field label="面布价格" value={sample.shellPrice} disabled={!canEdit} onChange={(value) => patchSample("shellPrice", value)} />
          <Field label="里布门幅" value={sample.liningWidth} disabled={!canEdit || unifiedMaterials} onChange={(value) => patchSample("liningWidth", value)} />
          <Field label="里布单耗" value={sample.liningConsumption} disabled={!canEdit || unifiedMaterials} onChange={(value) => patchSample("liningConsumption", value)} />
          <Field label="里布价格" value={sample.liningPrice} disabled={!canEdit} onChange={(value) => patchSample("liningPrice", value)} />
          <Field label="扣子价格" value={sample.buttonPrice} disabled={!canEdit} onChange={(value) => patchSample("buttonPrice", value)} />
          <Field label="工价" value={sample.laborPrice} disabled={!canEdit} onChange={(value) => patchSample("laborPrice", value)} />
          <Field label="其他辅料和走货费用" value={sample.otherTrimCost} disabled={!canEdit} onChange={(value) => patchSample("otherTrimCost", value)} />
          <Field label="总价" value={sample.totalPrice} disabled={!canEdit} onChange={(value) => patchSample("totalPrice", value)} />
          <Field label="拍照样" value={sample.photoSample} disabled={!canEdit} onChange={(value) => patchSample("photoSample", value)} />
          <Field label="销样" value={sample.salesSample} disabled={!canEdit || currentLocked} onChange={(value) => patchSample("salesSample", value)} />
          <Field label="贴纸" value={sample.sticker} disabled={!canEdit} onChange={(value) => patchSample("sticker", value)} />
        </div>
      </div>
      )}
      {kind === "sales_sample" ? null : (
      <div>
        <h3 className="font-medium">大货颜色、数量与辅料</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <span id="follow-materials" className="scroll-mt-24 md:col-span-2 text-sm font-medium">{unifiedMaterials ? <>原表面料摘要 · <a className="underline" href="#stage-materials">查看 / 修改本阶段完整资料</a></> : "本款面料资料"}</span>
          <Field label="成分" value={bulkDraft.composition || (kind === "bulk" ? sample.composition : "")} disabled={!canEdit || unifiedMaterials} onChange={(value) => updateOpen(style => ({ bulk: { ...style.bulk, composition: value }, ...(kind === "bulk" ? { salesSample: { ...style.salesSample, composition: value } } : {}) }))} />
          {kind === "bulk" ? <><Field label="面料克重" value={sample.gsm} disabled={!canEdit || unifiedMaterials} onChange={value => patchSample("gsm", value)} /><Field label="面料门幅" value={sample.shellWidth} disabled={!canEdit || unifiedMaterials} onChange={value => patchSample("shellWidth", value)} /><Field label="面料单耗" value={sample.shellConsumption} disabled={!canEdit || unifiedMaterials} onChange={value => patchSample("shellConsumption", value)} /></> : null}
        </div>
        <p className="mt-2 text-xs leading-6 text-[var(--ink-muted)]">客户采购日期是 PO 上的订单日期；要求出货日期是客户船期。出运登记从生产订单查回，进仓日期不替代采购日期。</p>
        {bulkDraft.orderNo && bulkDraft.orderNo !== bulkDraft.po ? (
          <div className="mt-3 rounded-lg border border-[var(--line)] p-3 text-sm">
            原订单号：{bulkDraft.orderNo}。与当前 PO 不同，请按客户原单核对。
            {canEdit && !currentLocked ? <div className="mt-2 flex flex-wrap gap-4">
              <button type="button" className="text-[var(--brand-strong)]" onClick={() => patchBulk("po", bulkDraft.orderNo)}>确认为客户 PO</button>
              <button type="button" className="text-[var(--brand-strong)]" onClick={() => { patchBulk("orderNo", ""); setMessage("原编号将在保存时归入修改记录，请核对客户 PO 后保存。"); setTone("ok"); }}>原编号不是客户 PO，归入修改记录</button>
            </div> : null}
          </div>
        ) : null}
        <div id="follow-colors" className="mt-4 scroll-mt-24 overflow-x-auto">
          <table className="sheet-table trim-sheet text-sm">
            <thead>
              <tr>
                <th rowSpan={2} className="trim-col-color">客人颜色</th>
                <th rowSpan={2} className="trim-col-name">厂色名</th>
                <th rowSpan={2} className="trim-col-qty">客户采购数量（件）</th>
                <th colSpan={5}>辅料</th>
                <th rowSpan={2}>操作</th>
              </tr>
              <tr>
                <th className="trim-col-trim">金属标</th>
                <th className="trim-col-trim">纽扣</th>
                <th className="trim-col-trim">拉链</th>
                <th className="trim-col-trim">裤钩</th>
                <th className="trim-col-note">其他辅料</th>
              </tr>
            </thead>
            <tbody>
              {colors.map((row, index) => (
                <tr key={index}>
                  {(["guestColor", "factoryColorName", "qtyText"] as const).map((key) => (
                    <td key={key} className={key === "guestColor" ? "trim-col-color" : key === "factoryColorName" ? "trim-col-name" : "trim-col-qty"}>
                      <input
                        className="w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-2 py-1"
                        value={row[key]}
                        aria-label={`${index + 1} 行${key === "guestColor" ? "客人颜色" : key === "factoryColorName" ? "厂色名" : "客户采购数量"}`}
                        disabled={!canEdit || (currentLocked && key !== "factoryColorName")}
                        placeholder={key === "qtyText" ? "不下" : ""}
                        onChange={(event) => patchColor(index, key, event.target.value)}
                      />
                    </td>
                  ))}
                  <td className="trim-col-trim align-top">
                    <TrimBox
                      label={`${row.guestColor || "这个颜色"}的金属标`}
                      value={row.metalBadge}
                      disabled={!canEdit}
                      onChange={(value) => patchColor(index, "metalBadge", value)}
                    />
                    <CellImageEditor label={`${row.guestColor || "这个颜色"}的金属标`} images={row.pictures?.metalBadge} disabled={!canEdit} onChange={images => updateOpen(style => ({ colors: style.colors.map((c, i) => i === index ? { ...c, pictures: { ...c.pictures, metalBadge: images } } : c) }))} onUploadChange={onUploadChange} />
                  </td>
                  {index === 0 ? (
                    <>
                      <td rowSpan={colors.length} className="trim-col-trim align-top">
                        <TrimBox label="纽扣" value={bulkDraft.button} disabled={!canEdit} onChange={(value) => patchBulk("button", value)} />
                        <CellImageEditor label="纽扣" images={bulkDraft.pictures?.button} disabled={!canEdit} onChange={images => patchBulkPictures("button", images)} onUploadChange={onUploadChange} />
                      </td>
                      <td rowSpan={colors.length} className="trim-col-trim align-top">
                        <TrimBox label="拉链" value={bulkDraft.zipper} disabled={!canEdit} onChange={(value) => patchBulk("zipper", value)} />
                        <CellImageEditor label="拉链" images={bulkDraft.pictures?.zipper} disabled={!canEdit} onChange={images => patchBulkPictures("zipper", images)} onUploadChange={onUploadChange} />
                      </td>
                      <td rowSpan={colors.length} className="trim-col-trim align-top">
                        <TrimBox label="裤钩" value={bulkDraft.hook} disabled={!canEdit} onChange={(value) => patchBulk("hook", value)} />
                        <CellImageEditor label="裤钩" images={bulkDraft.pictures?.hook} disabled={!canEdit} onChange={images => patchBulkPictures("hook", images)} onUploadChange={onUploadChange} />
                      </td>
                      <td rowSpan={colors.length} className="trim-col-note align-top">
                        <TrimBox
                          label="其他辅料"
                          value={bulkDraft.otherTrim}
                          disabled={!canEdit}
                          placeholder="吊牌、主唛、尺码唛、说明唛"
                          onChange={(value) => patchBulk("otherTrim", value)}
                        />
                        <CellImageEditor label="本款其他辅料" images={bulkDraft.pictures?.otherTrim} disabled={!canEdit} onChange={images => patchBulkPictures("otherTrim", images)} onUploadChange={onUploadChange} />
                      </td>
                    </>
                  ) : null}
                  <td>{canEdit && !currentLocked && index >= savedColorCount ? <button type="button" disabled={imageUploads > 0} className="whitespace-nowrap text-xs text-[var(--ink-muted)] underline" aria-label={`取消新增颜色 ${index + 1}`} onClick={() => {const next=colors.filter((_,i)=>i!==index);updateOpen({colors:next.length?next:[blankColor()]});}}>取消新增</button> : <span className="text-xs text-[var(--ink-muted)]">不做请记不下</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BulkLabelEditor key={current.rowId || open} bulk={{ ...bulkDraft, colors }} disabled={!canEdit} onMainLabel={value => patchBulk("mainLabel", value)} onMainImages={images => patchBulkPictures("mainLabel", images)} onUploadChange={onUploadChange} onColor={(index, patch) => updateOpen(style => ({ colors: style.colors.map((row, i) => i === index ? { ...row, ...patch, ...(patch.pictures ? { pictures: { ...row.pictures, ...patch.pictures } } : {}) } : row) }))} />
        {canEdit && !currentLocked ? (
          <button type="button" className="mt-3 text-sm text-[var(--brand-strong)]" onClick={() => updateOpen({ colors: [...colors, blankColor()] })}>
            加一个颜色
          </button>
        ) : null}
      </div>
      )}
      <DipBlock dip={dip} disabled={!canEdit} onChange={setDip} onPull={() => {
        const names = (kind === "bulk" ? colors : sample.colors.split(/[/、,，]/))
          .map((item) => (typeof item === "string" ? item : item.guestColor).trim())
          .filter(Boolean);
        const next = names.map((name) => dip.fabricColors.find((row) => row.name === name) ?? { name, guest: "" as const });
        if (next.length) setDip({ ...dip, fabricColors: next });
      }} />
      <div>
        <h3 className="font-medium">算出来的要买数量</h3>
        <p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">按单耗乘件数。工价不在这张表里。这不是采购单。</p>
        {purchases.length === 0 ? (
          <p className="mt-2 text-sm">还没有单耗或价格，所以没有要买的行。</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="sheet-table min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th>款</th>
                  <th>名称</th>
                  <th>单耗</th>
                  <th>价格</th>
                  <th>要买数量</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((line, index) => (
                  <tr key={`${line.styleCode}-${line.name}-${index}`}>
                    <td>{line.styleCode}</td>
                    <td>{line.name}</td>
                    <td>{line.consumption || "空"}</td>
                    <td>{line.price || "空"}</td>
                    <td>{line.buyQty || "空着"}</td>
                    <td>{line.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mt-6">
        <h3 id="follow-progress" className="scroll-mt-24 font-medium">进度</h3>
        {kind === "bulk" ? null : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {kind === "sales_sample" ? null : <p className="text-sm text-[var(--ink-muted)] md:col-span-2">销售样</p>}
            <Field label="面料进度" value={sample.fabricProgress} disabled={!canEdit} onChange={(value) => patchSample("fabricProgress", value)} />
            <Field label="扣子进度" value={sample.buttonProgress} disabled={!canEdit} onChange={(value) => patchSample("buttonProgress", value)} />
            <Field label="拉链进度" value={sample.zipperProgress} disabled={!canEdit} onChange={(value) => patchSample("zipperProgress", value)} />
            <Field label="进度" value={sample.progress} disabled={!canEdit} onChange={(value) => patchSample("progress", value)} />
          </div>
        )}
        {kind === "sales_sample" ? null : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {kind === "bulk" ? null : <p className="text-sm text-[var(--ink-muted)] md:col-span-2">大货</p>}
            <Field label="面料进度" value={bulkDraft.fabricProgress} disabled={!canEdit} onChange={(value) => patchBulk("fabricProgress", value)} />
            <Field label="扣子进度" value={bulkDraft.buttonProgress} disabled={!canEdit} onChange={(value) => patchBulk("buttonProgress", value)} />
            <Field label="拉链进度" value={bulkDraft.zipperProgress} disabled={!canEdit} onChange={(value) => patchBulk("zipperProgress", value)} />
            <Field label="进度" value={bulkDraft.progress} disabled={!canEdit} onChange={(value) => patchBulk("progress", value)} />
          </div>
        )}
      </div>
      {allowedEdit ? (
          <Button type="button" onClick={save} disabled={pending || imageUploads > 0}>
            {pending ? "保存中…" : imageUploads ? "图片上传中…" : "保存这一单的全部款"}
          </Button>
      ) : (
        <p className="text-sm text-[var(--ink-muted)]">当前角色只能看。</p>
      )}
      {message ? <p className={tone === "ok" ? "text-sm text-[var(--ok)]" : "text-sm text-[var(--danger)]"}>{message}</p> : null}
    </div>
  );
}
