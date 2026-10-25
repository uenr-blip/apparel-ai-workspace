export type FinanceCapabilities = { trade: boolean; ledger: boolean; legacy: boolean };
export type FinanceLink = { key: string; label: string; href: string };
const tabSections: Record<string, string> = {
  overview: "home", help: "home", receivables: "business", payables: "business", expenses: "business", reconciliation: "business", documents: "business", vouchers: "business",
  cash: "funds", treasury: "funds", bridge: "accounting", amounts: "accounting", ledger: "accounting", costs: "costs",
};
const link = (key: string, label: string, href: string): FinanceLink => ({ key, label, href });
export function financeNavigation(caps: FinanceCapabilities, params: Record<string, string | undefined>) {
  const any = caps.trade || caps.ledger || caps.legacy;
  const groups = [
    ...(any ? [link("home", "财务工作台", "/finance")] : []),
    ...(caps.trade || caps.legacy ? [link("business", "业务对账", "/finance?section=business")] : []),
    ...(caps.trade ? [link("funds", "收付与结汇", "/finance?section=funds")] : []),
    ...(caps.ledger ? [link("accounting", "会计账务", "/finance?section=accounting")] : []),
    ...(caps.trade ? [link("costs", "订单成本", "/finance?tab=costs")] : []),
  ];
  const defaults: Record<string, string> = { home: "overview", business: caps.trade ? "receivables" : "reconciliation", funds: "cash", accounting: caps.trade ? "bridge" : "ledger", costs: "costs" };
  const explicitTab = params.tab && Object.hasOwn(tabSections, params.tab) ? params.tab : undefined;
  const requestedSection = params.section && Object.hasOwn(defaults, params.section) ? params.section : "home";
  const tab = explicitTab ?? defaults[requestedSection], section = tabSections[tab];
  const allowed = tab === "overview" || tab === "help" ? any : ["bridge", "amounts"].includes(tab) ? caps.trade && caps.ledger :
    tab === "ledger" ? caps.ledger : ["reconciliation", "vouchers"].includes(tab) ? caps.legacy : caps.trade;
  const denied = !allowed || !groups.some(g => g.key === section);
  const view = !explicitTab && tab === "receivables" ? "bills" : params.view;
  const subKey = tab === "treasury" ? view === "fx" ? "fx" : "refund" : tab;
  const secondary = section === "business" ? [
    ...(caps.trade ? [link("receivables", "客户款项", "/finance?tab=receivables&view=bills"), link("payables", "供应商 / 工厂款项", "/finance?tab=payables"), link("expenses", "阶段费用", "/finance?tab=expenses")] :
      caps.legacy ? [link("reconciliation", "加工核对", "/finance?tab=reconciliation"), link("vouchers", "材料凭证", "/finance?tab=vouchers")] : []),
  ] : section === "funds" && caps.trade ? [
    link("cash", "收付款记录", "/finance?tab=cash"), link("refund", "退款登记", "/finance?tab=treasury&view=refund"), link("fx", "结汇 / 换汇", "/finance?tab=treasury&view=fx"),
  ] : section === "accounting" && caps.ledger ? [
    ...(caps.trade ? [link("bridge", "业务入账", "/finance?tab=bridge"), link("amounts", "金额对账", "/finance?tab=amounts")] : []), link("ledger", "会计账簿", "/finance?tab=ledger"),
  ] : [];
  const related: FinanceLink[] = section === "business" ? [
    ...(caps.trade && ["receivables", "documents"].includes(tab) ? [link("documents", "查订单单证", "/finance?tab=documents")] : []),
    ...(caps.legacy && ["payables", "reconciliation", "vouchers"].includes(tab) ? [link("reconciliation", "核对加工依据", "/finance?tab=reconciliation"), link("vouchers", "查材料凭证", "/finance?tab=vouchers")] : []),
    ...(caps.trade && ["payables", "vouchers"].includes(tab) ? [link("receipts", "收料与退补", "/resources/material-ledger")] : []),
  ].filter(item => item.key !== tab) : [];
  return { groups, section, tab, view, subKey, secondary, related, denied };
}

export const FINANCE_GUIDES: Record<string, { title: string; description: string; steps: string[] }> = {
  receivables: { title: "客户款项", description: "核对客户应该付多少、已经付多少，以及哪些款项还未结清。", steps: ["找到客户或订单", "核对金额与依据", "关联实际到账"] },
  expenses: { title: "阶段费用", description: "开发与未开生产单的销售样、大货费用按发生阶段留存，交接不自动分摊。", steps: ["选阶段登记并附凭据", "财务核对确认", "关联实际付款"] },
  payables: { title: "供应商 / 工厂款项", description: "先核对收料或加工依据，再确认应付和对应的实际付款。", steps: ["核对业务来源", "确认应付金额", "关联已发生付款"] },
  reconciliation: { title: "加工依据核对", description: "这里保存加工对账草稿，确认应付在供应商 / 工厂款项中办理。", steps: ["核对实际出运", "填写单价与依据", "保存加工草稿"] },
  documents: { title: "订单单证", description: "按订单集中查找合同、发票、报关等单证及原文件。", steps: ["找到订单", "登记或补充原件", "核对关联款项"] },
  vouchers: { title: "材料业务凭证", description: "核对材料在哪里、怎样流转；调拨和实际领用分开查看。", steps: ["查找材料或地点", "核对调拨与领用", "追到来源批次"] },
  cash: { title: "收付款记录", description: "记录银行已经发生的到账或付款，再与对应款项关联。", steps: ["登记实际收付", "找到对应款项", "分配并核销"] },
  refund: { title: "退款登记", description: "客户退款、供应商退款都从原收付款追溯，记录实际发生结果。", steps: ["找到原收付款", "登记实际退款", "核对关联记录"] },
  fx: { title: "结汇 / 换汇", description: "记录实际币种兑换、汇率与手续费，保留原收款来源。", steps: ["找到原收款", "填写换汇结果", "核对金额与费用"] },
  bridge: { title: "业务入账", description: "查看哪些业务待记账，哪些凭证已处理，哪些来源还需要核对。", steps: ["选择会计账簿", "核对业务来源", "制单、复核、过账"] },
  amounts: { title: "业务金额与总账核对", description: "按明确的科目与折算依据列出金额、差异和待确认项目。", steps: ["选择账簿与核对口径", "查看金额差异", "追溯业务及分录"] },
  ledger: { title: "会计账簿", description: "每个账簿保存一套会计记录。科目、期间等专业设置在选定账簿后办理。", steps: ["选择会计账簿", "查看凭证与试算", "按需进入会计设置"] },
  costs: { title: "订单成本", description: "按订单查看已登记的材料、加工及其他费用，缺少依据的金额会单独提示。", steps: ["选择订单", "查看成本构成", "追溯明细依据"] },
};
