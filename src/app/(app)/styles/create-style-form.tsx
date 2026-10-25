"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { StyleCatalog } from "@/server/services/style-catalog";
import type { ConstructionMaterialChoice } from "@/lib/style-construction";
import { StyleConstructionFields } from "./style-construction-fields";
import { FileWell } from "@/components/file-well";
import { Button } from "@/components/ui/button";
import { RosterSelect } from "./roster-select";
import { StyleCatalogFields, type CatalogPick } from "./style-catalog-fields";

export function CreateStyleForm({
  canEdit,
  designers = [],
  catalog,
  seasons = [],
  materials = [],
}: {
  canEdit: boolean;
  materials?: ConstructionMaterialChoice[];
  designers?: Array<{ id: string; name: string }>;
  catalog: StyleCatalog;
  seasons?: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [designerId, setDesignerId] = useState("");
  const [roster, setRoster] = useState(designers);
  const [addingDesigner, setAddingDesigner] = useState(false);
  const [localCatalog, setLocalCatalog] = useState(catalog);
  const [pick, setPick] = useState<CatalogPick>({
    brandOptionId: "",
    categoryOptionId: "",
    typeOptionId: "",
    yearOptionId: "",
  });

  if (!canEdit) {
    return <p className="text-sm text-[var(--ink-muted)]">当前角色不能新建款式主档。翻单请走收件箱，不要另建档。</p>;
  }

  async function addDesigner(name: string) {
    setAddingDesigner(true);
    setMessage("");
    const response = await fetch("/api/designers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await response.json()) as { error?: string; id?: string; name?: string };
    setAddingDesigner(false);
    if (!response.ok || !body.id || !body.name) {
      setMessage(body.error || "加入设计师失败");
      return;
    }
    const designer = { id: body.id, name: body.name };
    setRoster((current) => (current.some((item) => item.id === designer.id) ? current : [...current, designer]));
    setDesignerId(body.id);
    setMessage(`已加入 ${body.name}。这是款式署名，不是登录账号。`);
  }

  async function removeDesigner(id: string) {
    setAddingDesigner(true);
    setMessage("");
    const response = await fetch(`/api/designers/${id}`, { method: "DELETE" });
    const body = (await response.json()) as { error?: string; name?: string };
    setAddingDesigner(false);
    if (!response.ok) {
      setMessage(body.error || "撤下设计师失败");
      return;
    }
    setRoster((current) => current.filter((item) => item.id !== id));
    if (designerId === id) setDesignerId("");
    setMessage(`已从名单撤下 ${body.name ?? "设计师"}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
    const response = await fetch("/api/styles", {
      method: "POST",
      body: new FormData(form),
    });
    const body = (await response.json()) as { error?: string; message?: string; styleId?: string };
    setPending(false);
    if (!response.ok || !body.styleId) {
      setMessage(body.error || "建档失败");
      return;
    }
    setMessage(body.message || "已建档");
    form.reset();
    router.push(`/styles/${body.styleId}`);
    router.refresh();
    } catch { setMessage("连接中断，填写内容已保留，请重试。"); } finally { setPending(false); }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm text-[var(--ink-muted)]">
        款号由你填写，款名必填。品牌、季节和类型可在这里选好；订单 PO 建档后按批次登记。
      </p>
      <h3 className="pt-2 text-lg font-semibold"><span className="mr-3 text-sm text-[var(--ink-muted)]">01</span>基础信息</h3>
      <input type="hidden" name="designerId" value={designerId} />
      <input type="hidden" name="brandOptionId" value={pick.brandOptionId} />
      <input type="hidden" name="categoryOptionId" value={pick.categoryOptionId} />
      <input type="hidden" name="typeOptionId" value={pick.typeOptionId} />
      <input type="hidden" name="yearOptionId" value={pick.yearOptionId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm" htmlFor="new-style-code">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">款号（自行填写）</span>
          <input
            id="new-style-code"
            name="code"
            required
            placeholder="使用你们自己的款号"
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm"
          />
        </label>
        <label className="text-sm" htmlFor="new-style-name">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">款名</span>
          <input
            id="new-style-name"
            name="name"
            required
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--ink-muted)]">廓形（可后补）</span>
          <input
            name="silhouette"
            placeholder="未填写"
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm"
          />
        </label>
      </div>
      <label className="block text-sm" htmlFor="new-style-season">
        <span className="mb-1 block text-xs text-[var(--ink-muted)]">季节</span>
        <select id="new-style-season" name="seasonId" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--field-bg)] px-3 text-sm">
          <option value="">请选择，可后补</option>
          {seasons.map(season => <option key={season.id} value={season.id}>{season.code} {season.name}</option>)}
        </select>
      </label>
      <RosterSelect
        label="设计师（可空，署名不是登录账号）"
        value={designerId}
        options={roster}
        placeholder="请选择设计师"
        creating={addingDesigner}
        onChange={setDesignerId}
        onCreate={addDesigner}
        onRemove={removeDesigner}
      />
      <StyleCatalogFields catalog={localCatalog} value={pick} onChange={setPick} canEdit={canEdit} onCatalogPatch={setLocalCatalog} />
      <FileWell label="款式图" hint="可选，JPG / PNG" accept="image/jpeg,image/png,.jpg,.jpeg,.png" />
      <StyleConstructionFields materials={materials} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "建档中…" : "新建主档"}
      </Button>
      {message ? (
        <p className={`text-sm ${/失败|无权|已存在|填写/.test(message) ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
