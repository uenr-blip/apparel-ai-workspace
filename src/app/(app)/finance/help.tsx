import Link from "next/link";
import { Card } from "@/components/ui/card";
import { FinanceRoadmap } from "./overview";
import { financeNavigation } from "@/lib/finance-navigation";

export function FinanceHelp({ navigation }: { navigation: ReturnType<typeof financeNavigation> }) {
  const entries: Record<string, { question: string; answer: string }> = {
    home: { question: "不知道从哪里开始", answer: "回到财务工作台，先选择要办的事，再看已经登记的待处理记录。" },
    business: { question: "核对客户或供应商的一笔款", answer: "进入业务对账，选择客户款项或供应商 / 工厂款项，按订单和往来方找到记录，再核对金额及依据。" },
    funds: { question: "已经收到钱或已经付了钱", answer: "进入收付与结汇，登记真实发生的收付，再把流水分配到对应款项；退款和换汇也在这里办理。" },
    accounting: { question: "业务核对完，需要记账", answer: "进入会计账务。在业务入账中核对来源并制单，在会计账簿里查凭证、复核和过账；科目与期间设置也在账簿内。" },
    costs: { question: "想看一笔订单花了多少钱", answer: "进入订单成本选择订单，分材料、加工和其他费用查阅。缺价、未归单不表示零成本。" },
  };
  return <section className="space-y-5"><div className="grid gap-4 md:grid-cols-2">{navigation.groups.map(g => <Card key={g.key} className="space-y-3 p-5"><h2 className="font-semibold">{entries[g.key].question}</h2><p className="text-sm leading-7 text-[var(--ink-muted)]">{entries[g.key].answer}</p><Link href={g.href} className="block text-sm text-[var(--brand-strong)]">进入{g.label} →</Link></Card>)}</div>
    <Card className="space-y-4 p-5"><h2 className="font-semibold">几个常用词</h2><dl className="grid gap-4 text-sm md:grid-cols-2">{[
      ["应收 / 应付", "应收是客户应向公司支付的款项；应付是公司应向供应商或工厂结算的款项。"],
      ["核销", "把实际收付款与对应款项关联，用来查看哪些已结清、哪些还差多少。"],
      ["未分配金额", "流水已登记，但其中一部分还没有关联到具体款项，不等于银行账户余额。"],
      ["会计账簿（账套）", "一家企业的一套会计记录，包含科目、凭证和期间。业务对账与收付登记可以先使用。"],
      ["业务凭证 / 会计凭证", "收料、加工、银行流水等是业务依据；经明确科目、复核和过账形成会计记录。"],
      ["冲销", "保留原记录，通过有依据的反向记录更正；已经过账的凭证不能直接覆盖。"],
    ].map(([term, description]) => <div key={term}><dt className="font-medium">{term}</dt><dd className="mt-1 leading-7 text-[var(--ink-muted)]">{description}</dd></div>)}</dl></Card>
    <FinanceRoadmap />
  </section>;
}
