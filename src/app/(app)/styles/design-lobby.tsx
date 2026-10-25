import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/card";

type Draft = {
  id: string;
  code: string;
  name: string;
  status: string;
  href: string;
  coverSrc: string;
  styleCode: string | null;
  materialCode: string | null;
  variantCount: number;
};

export function DesignLobby({drafts}:{drafts:Draft[]}) {
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h3 className="font-[family-name:var(--font-display)] text-xl">最近草案</h3>
          <p className="text-sm text-[var(--ink-muted)]">{drafts.length} 份</p>
        </div>
        {drafts.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">还没有草案。点页头“新建设计草案”，写下想法后再选参考生成、改色或上身。</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {drafts.map((item) => (
              <Link key={item.id} href={item.href} className="design-flow">
                <div className="relative h-44 bg-[var(--paper)]">
                  {item.coverSrc ? (
                    <Image src={item.coverSrc} alt="" width={480} height={280} unoptimized className="h-full w-full object-contain" />
                  ) : (
                    <div className="design-draft-empty">等待模型出图</div>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{item.code}</p>
                    <Badge tone={item.status === "adopted" ? "ok" : "warning"}>
                      {item.status === "adopted" ? "已转入开发" : "创作中"}
                    </Badge>
                  </div>
                  <p>{item.name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {item.styleCode ?? "无正式款号"}
                    {item.materialCode ? ` · ${item.materialCode}` : ""}
                    {` · ${item.variantCount} 张方案`}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
