"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type SearchResult = {
  matchMethod: string;
  matchLabel: string;
  visionEnabled: boolean;
  styles: Array<{
    id: string;
    code: string;
    name: string;
    matchReasons: string[];
    differences: string[];
    historicalApprovalReusable: boolean;
  }>;
  materials: Array<{
    id: string;
    code: string;
    name: string;
    freeQty: string;
    unit: string;
    matchReasons: string[];
    differences: string[];
  }>;
};

export function ReuseSearch() {
  const [query, setQuery] = useState("找类似的圆领针织款，优先查看已有可用材料");
  const [projectId, setProjectId] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function search() {
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/reuse?q=${encodeURIComponent(query)}`);
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setMessage(body.error || "检索失败");
      return;
    }
    setResult(body);
  }

  async function adopt(kind: "style" | "material", id: string) {
    setMessage("");
    const response = await fetch("/api/reuse/adopt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, projectId, candidateKind: kind, candidateId: id }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "采用失败");
      return;
    }
    setMessage(`已建立引用，必须重确认：${(body.mustReconfirm ?? []).join("、")}`);
  }

  async function reject(kind: "style" | "material", id: string) {
    const reason = window.prompt("拒绝原因") || "不适合本次开发";
    const response = await fetch("/api/reuse/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, candidateKind: kind, candidateId: id, reason }),
    });
    const body = await response.json();
    setMessage(response.ok ? `已记录拒绝：${body.rejectReason}` : body.error || "拒绝失败");
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <p className="text-sm text-[var(--ink-muted)]">
          当前是数据库关键词/结构过滤，不是视觉识款。采用只会建立引用，不会把历史批准或旧价格当成这次可用。
        </p>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} name="reuseQuery" />
        <Input
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          name="projectId"
          placeholder="可选：开发款式 ID，采用时写入该项目"
        />
        <Button type="button" onClick={search} disabled={pending}>
          {pending ? "检索中…" : "检索历史资料"}
        </Button>
        {message ? <p className="text-sm text-[var(--warning)]">{message}</p> : null}
      </Card>
      {result ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">款式候选</h3>
              <Badge tone="ai">{result.matchLabel}</Badge>
            </div>
            <ul className="mt-3 space-y-3 text-sm">
              {result.styles.map((row) => (
                <li key={row.id} className="rounded-lg border border-[var(--line)] p-3">
                  <Link href={`/styles/${row.id}`} className="font-medium text-[var(--brand-strong)]">
                    {row.code} {row.name}
                  </Link>
                  <p>匹配：{row.matchReasons.join("；")}</p>
                  <p className="text-[var(--warning)]">差异：{row.differences.join("；")}</p>
                  <p className="text-xs">历史批准可直接沿用：否</p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" onClick={() => adopt("style", row.id)} disabled={!projectId}>
                      采用为引用
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => reject("style", row.id)}>
                      拒绝
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">材料候选</h3>
              <Badge tone="ai">{result.matchLabel}</Badge>
            </div>
            <ul className="mt-3 space-y-3 text-sm">
              {result.materials.map((row) => (
                <li key={row.id} className="rounded-lg border border-[var(--line)] p-3">
                  <Link href={`/resources/materials/${row.id}`} className="font-medium text-[var(--brand-strong)]">
                    {row.code} {row.name}
                  </Link>
                  <p>
                    可分配 {row.freeQty} {row.unit}
                  </p>
                  <p>匹配：{row.matchReasons.join("；")}</p>
                  <p className="text-[var(--warning)]">差异：{row.differences.join("；")}</p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" onClick={() => adopt("material", row.id)} disabled={!projectId}>
                      采用为引用
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => reject("material", row.id)}>
                      拒绝
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
