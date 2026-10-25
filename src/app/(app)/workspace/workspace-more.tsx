"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Clock3, FolderSearch, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/card";
import { labels } from "@/lib/labels";

type ReuseItem = {
  id: string;
  kind: string;
  href: string;
  imagePath?: string | null;
  matchLabel: string;
  code: string;
  name: string;
  matchReasons: string[];
  sourceLabel: string;
};

type FeedItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
};

type AuditItem = {
  id: string;
  summary: string;
  entityType: string;
};

export function WorkspaceMore({
  reuse,
  processed,
  audits,
}: {
  reuse: ReuseItem[];
  processed: FeedItem[];
  audits: AuditItem[];
}) {
  const [open, setOpen] = useState("");
  const tabs = [
    { id: "reuse", label: reuse.length ? `资料匹配 ${reuse.length}` : "资料匹配", icon: FolderSearch },
    { id: "done", label: processed.length ? `已经做过 ${processed.length}` : "已经做过", icon: ListChecks },
    { id: "feed", label: "最近活动", icon: Clock3 },
  ];

  return (
    <div className="mt-auto pt-5">
      <div className="chip-row" role="tablist" aria-label="桌上查阅">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={open === tab.id}
            className="chip"
            onClick={() => setOpen((value) => (value === tab.id ? "" : tab.id))}
          >
            <tab.icon size={14} strokeWidth={1.7} />
            {tab.label}
          </button>
        ))}
      </div>
      {open === "reuse" ? (
        <MorePanel empty={reuse.length === 0 ? "没有进行中的匹配。" : ""}>
          <ul className="grid gap-3 md:grid-cols-2">
            {reuse.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="tile overflow-hidden !p-0">
                <Link href={item.href} className="flex gap-3">
                  {item.imagePath ? (
                    <Image
                      src={item.imagePath}
                      alt={`${item.name} 示意`}
                      width={120}
                      height={88}
                      unoptimized
                      className="h-[88px] w-[120px] shrink-0 bg-[var(--paper)] object-cover"
                    />
                  ) : (
                    <div className="flex h-[88px] w-[120px] shrink-0 items-center justify-center bg-[var(--paper)] text-xs text-[var(--ink-muted)]">
                      {item.kind === "material" ? "材料" : "款式"}
                    </div>
                  )}
                  <div className="min-w-0 py-2.5 pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="ai">{item.matchLabel}</Badge>
                      <span className="font-medium">{item.code}</span>
                    </div>
                    <p className="mt-1 truncate">{item.name}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                      {item.matchReasons.join("；")} · {item.sourceLabel}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </MorePanel>
      ) : null}
      {open === "done" ? (
        <MorePanel empty={processed.length === 0 ? "还没有" : ""}>
          <ul className="desk-feed text-sm leading-6">
            {processed.map((item) => (
              <li key={item.id}>
                <Link className="desk-feed-link" href={item.href}>
                  <span className="desk-feed-title">{item.title}</span>
                  <span className="desk-feed-note">{item.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </MorePanel>
      ) : null}
      {open === "feed" ? (
        <MorePanel>
          <ol className="desk-feed text-sm leading-6">
            {audits.map((event) => (
              <li key={event.id} className="flex justify-between gap-4">
                <span>{event.summary}</span>
                <span className="shrink-0 text-[var(--ink-muted)]">{labels.entity(event.entityType)}</span>
              </li>
            ))}
          </ol>
        </MorePanel>
      ) : null}
    </div>
  );
}

function MorePanel({ children, empty }: { children: ReactNode; empty?: string }) {
  return (
    <div className="desk-more mt-4">
      {empty ? <p className="text-sm text-[var(--ink-muted)]">{empty}</p> : children}
    </div>
  );
}
