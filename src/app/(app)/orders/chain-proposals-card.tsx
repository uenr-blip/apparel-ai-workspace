import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SheetHead } from "@/components/ui/sheet";
import { labels } from "@/lib/labels";
import { canApproveAction } from "@/server/permissions";
import { DecisionActions } from "@/app/(app)/decisions/decision-actions";
import type { ChainProposalView } from "@/server/services/chain-proposals";

export function ChainProposalsCard({
  proposals,
  reasons,
  role,
}: {
  proposals: ChainProposalView[];
  reasons: string[];
  role: string;
}) {
  const open = proposals.filter((row) => row.status === "preview");
  const done = proposals.filter((row) => row.status !== "preview");

  return (
    <Card id="chain-proposals" className="desk-square scroll-mt-24">
      <SheetHead title="本单提案" />
      {done.length ? (
        <ul className="mt-3 space-y-3">
          {done.map((row) => (
            <li key={row.id}>
              <p className="text-sm font-medium leading-6 text-[var(--ok)]">{row.title}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                {labels.actionType(row.actionType)} · {labels.proposalStatus(row.status)}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                <Link href={row.href} className="text-[var(--brand-strong)]">
                  看依据
                </Link>
                <Link href={`/decisions/${row.id}`} className="text-[var(--brand-strong)]">
                  待确认与处理记录
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {open.length ? (
        <ul className="mt-3 space-y-3">
          {open.map((row) => (
            <li key={row.id}>
              <p className="text-sm font-medium">{row.title}</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {labels.actionType(row.actionType)} · {labels.proposalStatus(row.status)}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                <Link href={row.href} className="text-[var(--brand-strong)]">
                  看依据
                </Link>
                <Link href={`/decisions/${row.id}`} className="text-[var(--brand-strong)]">
                  待确认与处理记录
                </Link>
              </div>
              <div className="mt-3">
                <DecisionActions
                  proposalId={row.id}
                  status={row.status}
                  canDecide={canApproveAction(role, row.actionType)}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {!open.length && !done.length ? (
        <ul className="mt-3 space-y-1 text-sm leading-6 text-[var(--ink-muted)]">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
