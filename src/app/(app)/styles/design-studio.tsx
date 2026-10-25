"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DESIGN_COLORWAYS, DESIGN_PARTS, DESIGN_WORKFLOWS } from "@/lib/design-workflows";

type StudioProject = {
  id: string;
  code: string;
  name: string;
  brief: string;
  intent: string;
  status: string;
  styleCode: string | null;
  styleImageSrc?: string;
  materialCode: string | null;
  developmentCode: string | null;
  developmentProjectId: string | null;
  imageStatus: { ready: boolean; message: string };
  assets: Array<{ id: string; label: string; note: string; imageSrc: string }>;
  rounds: Array<{
    id: string;
    versionNumber: number;
    kind: string;
    prompt: string;
    instruction: string;
    mode: string;
    status: string;
    variants: Array<{
      id: string;
      slot: string;
      label: string;
      selected: boolean;
      origin: string;
      imageSrc: string;
    }>;
  }>;
};

type CatalogItem = { id: string; code: string; name: string; imageSrc: string };

export function DesignStudio({
  project,
  catalog = [],
  canEdit,
}: {
  project: StudioProject;
  catalog?: CatalogItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(project.brief || "");
  const [count, setCount] = useState(1);
  const [instruction, setInstruction] = useState("");
  const [intent, setIntent] = useState(project.intent);
  const [parts, setParts] = useState<string[]>(intent === "onbody" ? ["全身"] : []);
  const [colors, setColors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState("");
  const selectedIds = useMemo(
    () => project.rounds.flatMap((round) => round.variants.filter((item) => item.selected).map((item) => item.id)),
    [project.rounds],
  );
  const latest = project.rounds[0];
  const adopted = project.status === "adopted";
  const hero = project.assets[0];
  const workflow = DESIGN_WORKFLOWS.find((item) => item.intent === intent) ?? DESIGN_WORKFLOWS[0];
  const waiting = pending === "generate" || pending === "edit";
  const canvasSrc = hero?.imageSrc || project.styleImageSrc || "";
  const slots = useMemo(
    () =>
      ["A", "B", "C", "D"].slice(0, waiting ? count : latest?.variants.length || count).map((slot, index) => {
        const color = DESIGN_COLORWAYS.find((item) => item.id === colors[index]);
        const variant = latest?.variants.find((item) => item.slot === slot) ?? latest?.variants[index];
        return { slot, label: color?.label ?? `方案 ${slot}`, swatch: color?.swatch, variant };
      }),
    [colors, latest, count, waiting],
  );

  async function run(path: string, body: unknown, action: string) {
    setPending(action);
    setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) { setMessage(data.error || "操作失败"); return; }
      if (data.message) setMessage(data.message);
      router.refresh();
    } catch { setMessage("连接中断，结果尚未核实。请刷新查看已有记录，避免重复生成。"); }
    finally { setPending(""); }
  }

  async function upload(file: File) {
    setPending("upload");
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    form.set("label", file.name);
    const response = await fetch(`/api/design/${project.id}/assets`, { method: "POST", body: form });
    const data = (await response.json()) as { error?: string };
    setPending("");
    if (!response.ok) {
      setMessage(data.error || "上传失败");
      return;
    }
    router.refresh();
  }

  async function bindReference(styleId: string) {
    await run(`/api/design/${project.id}/reference`, { styleId }, "reference");
  }

  async function toggle(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id];
    await run(`/api/design/${project.id}/select`, { variantIds: next }, "select");
  }

  function composedPrompt() {
    const partText = parts.length ? `部位：${parts.join("、")}` : "";
    const colorText = colors.length
      ? `色路：${colors.map((id) => DESIGN_COLORWAYS.find((item) => item.id === id)?.label).filter(Boolean).join("、")}`
      : "";
    return [prompt.trim(), partText, colorText].filter(Boolean).join("。");
  }

  function generate() {
    void run(`/api/design/${project.id}/generate`, { prompt: composedPrompt(), intent, count }, "generate");
  }

  return (
    <div className="design-studio">
      <div className="flex items-center gap-3 text-sm"><label>每次生成张数 <select aria-label="每次生成张数" value={count} onChange={e => setCount(Number(e.target.value))} disabled={Boolean(pending)} className="rounded border border-[var(--line)] bg-[var(--field-solid)] p-1">{[1,2,3,4].map(n => <option key={n} value={n}>{n} 张</option>)}</select></label><span className="text-[var(--ink-muted)]">真实调用百炼；图片供开发审阅，采用后仍是待确认草稿。</span></div>
      <header className="design-studio-head">
        <div>
          <p className="text-[11px] tracking-[0.18em] text-[var(--ink-muted)]">
            AI设计工作台 · {project.code} · {workflow.title}
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-[1.7rem] leading-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {project.styleCode ? `挂着 ${project.styleCode}` : "还没有正式款号"}
            {project.materialCode ? ` · 材料 ${project.materialCode}` : ""}
            {project.developmentCode ? ` · 已转入 ${project.developmentCode}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("design-model-chip", project.imageStatus.ready && "design-model-chip-on")}>
            {project.imageStatus.ready ? "图像服务已配置" : "模型未接上"}
          </span>
          <Link href="/styles?tab=design" className="text-sm text-[var(--brand-strong)]">
            返回工作台
          </Link>
        </div>
      </header>

      <div className="design-workbench">
        <aside className="design-console">
          <p className="design-kicker">参考</p>
          <label className="design-ref">
            {canvasSrc ? (
              <Image
                src={canvasSrc}
                alt={hero?.label || project.styleCode || "参考款"}
                width={800}
                height={960}
                unoptimized
                className="design-ref-img"
              />
            ) : (
              <span className="design-ref-empty">
                <span className="file-well-plus" aria-hidden>
                  +
                </span>
                <span>上传款图、色卡或草图</span>
                <span className="design-ref-empty-hint">点击选择，或拖到这里。这是参考，不是新主档。</span>
              </span>
            )}
            {canEdit && !adopted ? (
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            ) : null}
          </label>
          {catalog.length ? (
            <div className="design-hero-thumbs">
              {catalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={`${item.code} ${item.name}`}
                  className={cn("design-thumb", (project.styleImageSrc === item.imageSrc || canvasSrc === item.imageSrc) && "design-thumb-on")}
                  onClick={() => void bindReference(item.id)}
                >
                  <Image src={item.imageSrc} alt={item.code} width={56} height={56} unoptimized />
                </button>
              ))}
            </div>
          ) : null}

          <p className="design-kicker mt-5">工作流</p>
          <div className="design-intent-list">
            {DESIGN_WORKFLOWS.map((flow) => (
              <button
                key={flow.id}
                type="button"
                className={cn("design-intent", intent === flow.intent && "design-intent-on")}
                onClick={() => setIntent(flow.intent)}
              >
                <span>{flow.kicker}</span>
                <strong>{flow.title}</strong>
              </button>
            ))}
          </div>

          <p className="design-kicker mt-5">部位</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DESIGN_PARTS.map((part) => (
              <button
                key={part}
                type="button"
                className={cn("design-chip", parts.includes(part) && "design-chip-on")}
                onClick={() =>
                  setParts((current) => (current.includes(part) ? current.filter((item) => item !== part) : [...current, part]))
                }
              >
                {part}
              </button>
            ))}
          </div>

          <p className="design-kicker mt-5">色路</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DESIGN_COLORWAYS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn("design-chip inline-flex items-center gap-1.5", colors.includes(item.id) && "design-chip-on")}
                onClick={() =>
                  setColors((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))
                }
              >
                <span className="h-3 w-3 rounded-full border border-[var(--line)]" style={{ background: item.swatch }} />
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        <section className="design-stage-shell">
          <div className="atmosphere-aurora design-stage-aurora" />
          <div className="design-stage-head">
            <div>
              <p className="design-kicker">模型输出</p>
              <h2 className="font-[family-name:var(--font-display)] text-[1.35rem]">
                {waiting ? `正在生成 ${count} 张方案` : latest ? `第 ${latest.versionNumber} 轮 · 点选比较` : `本次生成 ${count} 张方案`}
              </h2>
            </div>
            <p className="text-sm text-[var(--ink-muted)]">
              {project.imageStatus.ready ? "生成会真实调用图像模型。" : "未接上时会明确失败，不会出假图。"}
            </p>
          </div>

          {latest ? <p className="px-3 text-sm text-[var(--ink-muted)]">本轮要求：{latest.kind === "edit" ? latest.instruction : latest.prompt}</p> : null}
          <div className="design-bays">
            {slots.map((item) => {
              if (waiting) {
                return (
                  <div key={item.slot} className="design-bay design-bay-wait">
                    <span className="design-bay-mark">{item.slot}</span>
                    <span className="design-bay-label">{item.label}</span>
                  </div>
                );
              }
              if (item.variant) {
                return (
                  <button
                    key={item.slot}
                    type="button"
                    data-no-zoom="true"
                    aria-pressed={item.variant.selected}
                    disabled={Boolean(pending) || adopted}
                    onClick={() => void toggle(item.variant!.id)}
                    className={cn("design-bay", item.variant.selected && "design-bay-on")}
                  >
                    <Image src={item.variant.imageSrc} alt={item.variant.label} width={720} height={720} unoptimized className="design-bay-img" />
                    <span className="design-bay-caption">
                      {item.variant.slot} {item.variant.label}
                      {item.variant.selected ? " · 已选" : ""}
                    </span>
                  </button>
                );
              }
              return (
                <div key={item.slot} className="design-bay design-bay-empty">
                  <span className="design-bay-swatch" style={{ background: item.swatch }} />
                  <span className="design-bay-mark">{item.slot}</span>
                  <span className="design-bay-label">{item.label}</span>
                </div>
              );
            })}
          </div>

          {project.rounds.length > 1 ? <details className="p-3 text-sm"><summary>历史方案 · 查看原图与修改记录</summary><div className="grid grid-cols-2 gap-3">{project.rounds.slice(1).map(round => <section key={round.id}><p>第 {round.versionNumber} 轮 · {round.kind === "edit" ? "修改" : "生成"}</p><p className="my-2 whitespace-pre-wrap text-[var(--ink-muted)]">{round.kind === "edit" ? round.instruction : round.prompt}</p>{round.variants.map(v => <button key={v.id} type="button" data-no-zoom="true" aria-pressed={v.selected} disabled={Boolean(pending) || adopted} onClick={() => void toggle(v.id)} className="m-1 rounded border border-[var(--line)] p-2"><Image src={v.imageSrc} alt={`第${round.versionNumber}轮 ${v.label}`} width={220} height={220} unoptimized /><span>{v.label}{v.selected ? " · 已选" : " · 点击选定"}</span></button>)}</section>)}</div></details> : null}
          <div className="design-prompt-bar">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canEdit && !adopted && !pending) {
                  event.preventDefault();
                  generate();
                }
              }}
              rows={2}
              className="design-prompt-input"
              placeholder={workflow.hint}
            />
            {canEdit && !adopted ? (
              <button type="button" className="design-gen-btn" disabled={Boolean(pending)} onClick={generate}>
                <Sparkles size={18} />
                {pending === "generate" ? "正在生成…" : `生成 ${count} 张`}
              </button>
            ) : null}
          </div>

          {message ? <p className="design-fail">{message}</p> : null}

          <div className="design-bottom-bar">
            <label className="block min-w-[16rem] flex-1 text-sm">
              定向修改
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 py-2"
                placeholder="只改口袋，领子保持"
              />
            </label>
            {canEdit && !adopted ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(pending)}
                  onClick={() => void run(`/api/design/${project.id}/edit`, { instruction }, "edit")}
                >
                  {pending === "edit" ? "正在改…" : "按选定修改 1 张"}
                </Button>
                <Button
                  type="button"
                  disabled={Boolean(pending) || selectedIds.length === 0}
                  onClick={() => void run(`/api/design/${project.id}/adopt`, { target: "development" }, "adopt")}
                >
                  转入开发款式
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(pending) || selectedIds.length === 0}
                  onClick={() => void run(`/api/design/${project.id}/adopt`, { target: "style" }, "adopt")}
                >
                  转入资料草稿
                </Button>
              </div>
            ) : null}
            <p className="basis-full text-sm text-[var(--ink-muted)]">
              {selectedIds.length ? `已选 ${selectedIds.length} 张。采用才转入开发，不是批准，也不采购。` : "点方案放进比较。采用前至少选一张。"}
            </p>
            {adopted && project.developmentCode ? (
              <Link href={`/projects/${project.developmentProjectId}`} className="text-sm text-[var(--brand-strong)]">
                看 {project.developmentCode}
              </Link>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
