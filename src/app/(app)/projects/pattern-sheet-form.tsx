"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SheetPicture } from "@/app/(app)/orders/sheet-picture";
import {
  CRAFT_LABEL,
  PATTERN_ORIGIN_LABEL,
  type CraftFamily,
  type FabricSheet,
  type PatternOrigin,
  type SweaterSheet,
} from "@/server/domain/craft-sheet";

const fieldClass =
  "mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2 text-sm";

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input className={fieldClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function PatternSheetForm({
  projectId,
  expectedUpdatedAt,
  origin,
  originNote,
  craftFamily,
  sweater,
  fabric,
  canEdit,
  styleImage,
  styleLabel,
}: {
  projectId: string;
  expectedUpdatedAt: string;
  origin: PatternOrigin | "";
  originNote: string;
  craftFamily: CraftFamily | "";
  sweater: SweaterSheet;
  fabric: FabricSheet;
  canEdit: boolean;
  styleImage: string | null;
  styleLabel: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"ok" | "danger">("ok");
  const [stamp, setStamp] = useState(expectedUpdatedAt);
  const [draftOrigin, setDraftOrigin] = useState(origin);
  const [draftOriginNote, setDraftOriginNote] = useState(originNote);
  const [family, setFamily] = useState<CraftFamily | "">(craftFamily);
  const [sweaterDraft, setSweaterDraft] = useState(sweater);
  const [fabricDraft, setFabricDraft] = useState(fabric);

  async function save() {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/projects/${projectId}/pattern-sheet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: stamp,
        idempotencyKey: crypto.randomUUID(),
        origin: draftOrigin,
        originNote: draftOriginNote,
        craftFamily: family,
        sweater: sweaterDraft,
        fabric: fabricDraft,
      }),
    });
    const body = (await response.json()) as { error?: string; message?: string; expectedUpdatedAt?: string };
    setPending(false);
    if (!response.ok) {
      setTone("danger");
      setMessage(body.error || "保存失败");
      return;
    }
    if (body.expectedUpdatedAt) setStamp(body.expectedUpdatedAt);
    setTone("ok");
    setMessage(body.message || "已保存");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-[var(--ink)]">
        做款先记版单。毛衣记纱线，针织和梭织记面料。保存不批准资料，也不采购。
      </p>
      {styleImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={styleImage} alt={styleLabel ?? "款式图"} className="h-28 w-36 rounded-xl object-cover" />
      ) : (
        <p className="text-sm text-[var(--ink-muted)]">{styleLabel ? `${styleLabel} 还没有款式图。` : "还没关联款号，图可以后补。"}</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          这款从哪来
          <select
            className={fieldClass}
            value={draftOrigin}
            disabled={!canEdit}
            onChange={(event) => setDraftOrigin(event.target.value as PatternOrigin | "")}
          >
            <option value="">还没写</option>
            {(Object.keys(PATTERN_ORIGIN_LABEL) as PatternOrigin[]).map((item) => (
              <option key={item} value={item}>
                {PATTERN_ORIGIN_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        <Field label="来源补充" value={draftOriginNote} disabled={!canEdit} onChange={setDraftOriginNote} />
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="版单类型">
        {(Object.keys(CRAFT_LABEL) as CraftFamily[]).map((item) => (
          <button
            key={item}
            type="button"
            disabled={!canEdit}
            aria-pressed={family === item}
            className={
              family === item
                ? "rounded-full bg-[var(--brand)] px-3 py-1 text-sm text-[var(--on-brand)]"
                : "rounded-full border border-[var(--line)] px-3 py-1 text-sm"
            }
            onClick={() => setFamily(item)}
          >
            {CRAFT_LABEL[item]}
          </button>
        ))}
      </div>
      {family === "sweater" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <SheetPicture
              label="款式图"
              imageSrc={sweaterDraft.imagePath}
              disabled={!canEdit}
              onChange={(imageSrc) => setSweaterDraft({ ...sweaterDraft, imagePath: imageSrc })}
            />
          </div>
          <Field label="图注" value={sweaterDraft.imageNote} disabled={!canEdit} onChange={(value) => setSweaterDraft({ ...sweaterDraft, imageNote: value })} />
          <Field label="纱线成分" value={sweaterDraft.yarnComposition} disabled={!canEdit} onChange={(value) => setSweaterDraft({ ...sweaterDraft, yarnComposition: value })} />
          <Field label="纱线支数" value={sweaterDraft.yarnCount} disabled={!canEdit} onChange={(value) => setSweaterDraft({ ...sweaterDraft, yarnCount: value })} />
          <Field label="大身组织" value={sweaterDraft.bodyStructure} disabled={!canEdit} onChange={(value) => setSweaterDraft({ ...sweaterDraft, bodyStructure: value })} />
          <Field label="针型" value={sweaterDraft.needleType} disabled={!canEdit} onChange={(value) => setSweaterDraft({ ...sweaterDraft, needleType: value })} />
          <Field label="纱线供应商" value={sweaterDraft.yarnSupplier} disabled={!canEdit} onChange={(value) => setSweaterDraft({ ...sweaterDraft, yarnSupplier: value })} />
          <Field label="纱线价格" value={sweaterDraft.yarnPrice} disabled={!canEdit} onChange={(value) => setSweaterDraft({ ...sweaterDraft, yarnPrice: value })} />
          <label className="block text-sm">
            库存与否
            <select className={fieldClass} value={sweaterDraft.inStock} disabled={!canEdit} onChange={(event) => setSweaterDraft({ ...sweaterDraft, inStock: event.target.value as SweaterSheet["inStock"] })}>
              <option value="">还没问</option>
              <option value="yes">有库存</option>
              <option value="no">没有库存</option>
              <option value="unknown">还不知道</option>
            </select>
          </label>
          <Field label="定制纱价格" value={sweaterDraft.customYarnPrice} disabled={!canEdit} onChange={(value) => setSweaterDraft({ ...sweaterDraft, customYarnPrice: value })} />
        </div>
      ) : null}
      {family === "knit" || family === "woven" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <SheetPicture
              label="图片"
              imageSrc={fabricDraft.imagePath}
              disabled={!canEdit}
              onChange={(imageSrc) => setFabricDraft({ ...fabricDraft, imagePath: imageSrc })}
            />
          </div>
          <Field label="图注" value={fabricDraft.imageNote} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, imageNote: value })} />
          <Field label="面料成分" value={fabricDraft.fabricComposition} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, fabricComposition: value })} />
          <Field label="克重" value={fabricDraft.gsm} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, gsm: value })} />
          <Field label="规格" value={fabricDraft.spec} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, spec: value })} />
          <Field label="门幅" value={fabricDraft.width} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, width: value })} />
          <Field label="供应商" value={fabricDraft.supplier} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, supplier: value })} />
          <Field label="价格" value={fabricDraft.price} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, price: value })} />
          <label className="block text-sm">
            库存与否
            <select className={fieldClass} value={fabricDraft.inStock} disabled={!canEdit} onChange={(event) => setFabricDraft({ ...fabricDraft, inStock: event.target.value as FabricSheet["inStock"] })}>
              <option value="">还没问</option>
              <option value="yes">有库存</option>
              <option value="no">没有库存</option>
              <option value="unknown">还不知道</option>
            </select>
          </label>
          <Field label="定数量和价格" value={fabricDraft.orderQtyPrice} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, orderQtyPrice: value })} />
          <Field label="里布" value={fabricDraft.lining} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, lining: value })} />
          <Field label="辅料" value={fabricDraft.trims} disabled={!canEdit} onChange={(value) => setFabricDraft({ ...fabricDraft, trims: value })} />
        </div>
      ) : null}
      {canEdit ? (
        <Button type="button" onClick={save} disabled={pending || !family}>
          {pending ? "保存中…" : "保存版单"}
        </Button>
      ) : (
        <p className="text-sm text-[var(--ink-muted)]">当前角色只能看版单。</p>
      )}
      {message ? <p className={tone === "ok" ? "text-sm text-[var(--ok)]" : "text-sm text-[var(--danger)]"}>{message}</p> : null}
    </div>
  );
}
