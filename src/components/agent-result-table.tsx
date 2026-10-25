import Link from "next/link";
import type { AgentTable } from "@/lib/agent-table";

export function AgentResultTable({ table }: { table: AgentTable }) {
  return <section className="min-w-0 space-y-2">
    {table.conclusion ? <div role="status" className={`space-y-2 rounded-xl border border-[var(--line)] p-4 ${table.conclusion.tone === "neutral" ? "" : "border-l-4 border-l-[var(--warning)]"}`}>
      <p className="font-medium">{table.conclusion.title}</p>
      <p className="text-sm">{table.conclusion.detail}</p>
      <p className="text-sm">下一步：{table.conclusion.nextStep}</p>
    </div> : null}
    {!table.rows.length ? <div className="rounded-xl border border-[var(--line)] p-4" role="region" aria-label={table.title}>
      <p className="text-sm font-medium">{table.title}</p>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">{table.emptyMessage}</p>
    </div> :
    <div className="max-w-full overflow-x-auto rounded-xl border border-[var(--line)]" role="region" aria-label={table.title} tabIndex={0}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="px-3 py-3 text-left font-medium">{table.title}</caption>
        <thead className="bg-[var(--brand-soft)]"><tr>{table.columns.map((label, i) => <th key={i} scope="col" className="whitespace-nowrap border-y border-[var(--line)] px-3 py-2 font-medium">{label}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, i) => <tr key={i}>
          {table.columns.map((_, j) => {
            const value = row.cells[j];
            const content = value === null || value === undefined || value === "" ? "未记录" : value;
            const className = "min-w-24 max-w-sm whitespace-pre-line break-words border-b border-[var(--line)] px-3 py-3 align-top font-normal";
            return j === 0 ? <th key={j} scope="row" className={className}>{row.href ? <Link className="underline underline-offset-4" href={row.href}>{content}</Link> : content}</th> : <td key={j} className={className}>{content}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>}
    {table.notes?.map((note, i) => <p key={i} className="text-xs leading-5 text-[var(--ink-muted)]">{note}</p>)}
  </section>;
}
