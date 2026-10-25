import Image from "next/image";
import Link from "next/link";
import type { SeasonBoard, SeasonRow } from "@/server/domain/merch-sheet";

function factoryGroups(rows: SeasonRow[]) {
  const groups = new Map<string, SeasonRow[]>();
  for (const row of rows) {
    const name = row.factoryName.trim() || "还没写工厂";
    const bucket = groups.get(name) ?? [];
    bucket.push(row);
    groups.set(name, bucket);
  }
  return [...groups.entries()].map(([name, groupRows]) => ({ name, rows: groupRows }));
}

export function SeasonBoardView({ board }: { board: SeasonBoard }) {
  const { counts } = board;
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6">
        毛衣 {counts.sweater} 款，针织 {counts.knit} 款，梭织 {counts.woven} 款。
        {counts.unset ? ` 还有 ${counts.unset} 款没写类型。` : ""}
        同一张单里的款排在一起。写下「不下」的颜色不进要买数量。
      </p>
      <div className="space-y-6">
        {board.rows.length === 0 ? <p className="text-sm">还没有填过的销售样或大货。</p> : null}
        {factoryGroups(board.rows).map((group) => (
          <div key={group.name}>
            <h3 className="font-medium">{group.name}</h3>
            <p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">{group.rows.map((row) => [row.styleCode, row.styleName].filter(Boolean).join(" ") || "未写款号").join("、")}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="sheet-table min-w-[980px] text-sm">
                <thead>
                  <tr>
                    <th>订单</th>
                    <th>图</th>
                    <th>款号</th>
                    <th>款名</th>
                    <th>成分</th>
                    <th>每色数量</th>
                    <th>货期</th>
                    <th>辅料</th>
                    <th>进度</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, index) => (
                    <tr key={`${row.orderId}-${row.styleCode}-${index}`}>
                      <td>
                        <Link href={row.href} className="text-[var(--brand-strong)]">
                          {row.orderNo}
                        </Link>
                      </td>
                      <td>
                        {row.imagePath.startsWith("/") || row.imagePath.startsWith("http") ? (
                          <Image src={row.imagePath} alt="" width={72} height={54} unoptimized className="h-[54px] w-[72px] rounded-lg object-cover" />
                        ) : (
                          "无图"
                        )}
                      </td>
                      <td>
                        <Link href={row.href} className="text-[var(--brand-strong)]">
                          {row.styleCode || "未写款号"}
                        </Link>
                      </td>
                      <td>{row.styleName || "—"}</td>
                      <td>{row.composition || "空"}</td>
                      <td>{row.colorQty || "空"}</td>
                      <td>{row.delivery || "空"}</td>
                      <td>{row.trims || "空"}</td>
                      <td>{row.progress || "空"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <div>
        <h3 className="font-medium">要买的料</h3>
        <p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">名称、单耗、价格、要买数量。这是算出来的，不是已经下达的采购。</p>
        <div className="mt-3 overflow-x-auto">
          <table className="sheet-table min-w-[760px] text-sm">
            <thead>
              <tr>
                <th>款</th>
                <th>名称</th>
                <th>单耗</th>
                <th>价格</th>
                <th>要买数量</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {board.purchases.length === 0 ? (
                <tr>
                  <td colSpan={6}>还没有能算的单耗或价格。</td>
                </tr>
              ) : null}
              {board.purchases.map((line, index) => (
                <tr key={`${line.orderNo}-${line.name}-${index}`}>
                  <td>{line.styleCode}</td>
                  <td>{line.name}</td>
                  <td>{line.consumption || "空"}</td>
                  <td>{line.price || "空"}</td>
                  <td>{line.buyQty || "空着"}</td>
                  <td>{line.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
