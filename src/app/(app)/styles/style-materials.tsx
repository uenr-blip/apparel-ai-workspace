import Link from "next/link";
import type { Material } from "@prisma/client";
import { isRecordedConsumption } from "@/server/services/style-bom";

type MaterialLine = { id: string; consumption: string; unit: string; confirmed: boolean; material: Material };

export function StyleMaterials({ lines }: { lines: MaterialLine[] }) {
  const groups = [{ title: "面料与纱线", kinds: ["fabric", "yarn"] }, { title: "辅料", kinds: ["trim"] }];
  const labels: Record<string, string> = { fabric: "面料", yarn: "纱线", trim: "辅料" };
  return <div className="mt-4 grid gap-5 lg:grid-cols-2">
    {groups.map(group => {
      const items = lines.filter(line => group.kinds.includes(line.material.kind)).sort((a, b) => group.kinds.indexOf(a.material.kind) - group.kinds.indexOf(b.material.kind) || a.material.code.localeCompare(b.material.code));
      const counts: Record<string, number> = {};
      return <section key={group.title} className="min-w-0">
        <h4 className="text-sm font-medium">{group.title} <span className="text-[var(--ink-muted)]">{items.length}</span></h4>
        {items.length ? <ul className="mt-2 space-y-2">{items.map(line => {
          const m = line.material;
          counts[m.kind] = (counts[m.kind] || 0) + 1;
          return <li key={line.id} className="rounded-xl border border-[var(--line)] p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs text-[var(--ink-muted)]">{labels[m.kind]} {counts[m.kind]}</span>
              <Link className="font-medium text-[var(--brand-strong)] underline underline-offset-4" href={`/resources/materials/${m.id}`}>{m.name}</Link>
              <span className="text-xs text-[var(--ink-muted)]">{m.code}{m.archivedAt ? " · 已归档" : ""}</span>
            </div>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="inline text-[var(--ink-muted)]">规格 / 组织：</dt><dd className="inline break-words">{m.specSummary || "待补"}</dd></div>
              {m.kind !== "trim" ? <>
                <div className="sm:col-span-2"><dt className="inline text-[var(--ink-muted)]">成分：</dt><dd className="inline break-words">{m.composition || "待补"}</dd></div>
                {m.kind === "fabric" || m.gsm ? <div><dt className="inline text-[var(--ink-muted)]">克重：</dt><dd className="inline">{m.gsm ? `${m.gsm} g/m²` : "待补"}</dd></div> : null}
                {m.kind === "fabric" || m.widthCm ? <div><dt className="inline text-[var(--ink-muted)]">门幅：</dt><dd className="inline">{m.widthCm ? `${m.widthCm} cm` : "待补"}</dd></div> : null}
              </> : null}
              <div className="sm:col-span-2"><dt className="inline text-[var(--ink-muted)]">单耗：</dt><dd className="inline">{isRecordedConsumption(line.consumption) ? `${line.consumption} ${line.unit} / 件 · ${line.confirmed ? "已确认" : "待确认"}` : `待填写（${line.unit} / 件）`}</dd></div>
            </dl>
          </li>;
        })}</ul> : <p className="mt-2 rounded-xl bg-[var(--paper)] p-3 text-xs text-[var(--ink-muted)]">本版资料尚未选入{group.title}。</p>}
      </section>;
    })}
  </div>;
}
