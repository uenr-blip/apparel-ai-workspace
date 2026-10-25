import type { ProductionColorSize } from "@/server/services/production-board";

export function ColorSizeNestedTable({
  colorSize,
  orderTotals,
}: {
  colorSize: ProductionColorSize;
  orderTotals?: { started: number; good: number; shipped: number; leftover: number };
}) {
  const groups = colorSize.colors.map((color) => ({
    colorName: color.colorName,
    rows: colorSize.matrix.filter((row) => row.colorName === color.colorName),
  }));
  const totals = colorSize.matrix.reduce(
    (sum, row) => ({
      ordered: sum.ordered + (row.ordered ?? 0),
      started: sum.started + row.started,
      good: sum.good + row.good,
      shipped: sum.shipped + row.shipped,
      leftover: sum.leftover + row.leftover,
    }),
    { ordered: 0, started: 0, good: 0, shipped: 0, leftover: 0 },
  );

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-[640px] w-full border-collapse text-sm">
        <thead className="text-left text-[var(--ink-muted)]">
          <tr>
            <th className="border-b border-[var(--line)] py-2 pr-3">颜色</th>
            <th className="border-b border-[var(--line)] py-2 pr-3">尺码</th>
            {colorSize.columns.map((column) => (
              <th key={column} className="border-b border-[var(--line)] py-2 pr-3">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) =>
            group.rows.map((row, index) => (
              <tr key={`${row.colorName}-${row.sizeCode}`} className="border-t border-[var(--line)]">
                {index === 0 ? (
                  <td className="py-2 pr-3 align-top font-medium" rowSpan={group.rows.length}>
                    {group.colorName}
                  </td>
                ) : null}
                <td className="py-2 pr-3">{row.sizeCode}</td>
                <td className="py-2 pr-3">{row.ordered ?? "未知"}</td>
                <td className="py-2 pr-3">{row.started}</td>
                <td className="py-2 pr-3">{row.good}</td>
                <td className="py-2 pr-3">{row.shipped}</td>
                <td className="py-2 pr-3">{row.leftover}</td>
              </tr>
            )),
          )}
          <tr className="border-t border-[var(--line)] font-medium">
            <td className="py-2 pr-3" colSpan={2}>
              合计
            </td>
            <td className="py-2 pr-3">{totals.ordered}</td>
            <td className="py-2 pr-3">{totals.started}</td>
            <td className="py-2 pr-3">{totals.good}</td>
            <td className="py-2 pr-3">{totals.shipped}</td>
            <td className="py-2 pr-3">{totals.leftover}</td>
          </tr>
        </tbody>
      </table>
      {orderTotals && orderTotals.started > totals.started ? (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          整单已记投产 {orderTotals.started}、合格 {orderTotals.good}、发运 {orderTotals.shipped}。上表产量只含按色尺登记的行，不是开裁/车间/后整。
        </p>
      ) : null}
    </div>
  );
}
