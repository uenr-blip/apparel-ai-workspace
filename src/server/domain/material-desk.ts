const DRAFT_WITHOUT_BOM = new Set([
  "料况未知",
  "本单草稿没有面辅料",
  "还没有可判断的面辅料需求",
  "无面辅料，不能算毛需求",
  "本单当前资料草稿无面辅料，比较按该款已批准资料计算",
]);

export function materialDeskCopy(input: {
  supplyLabel: string;
  supplyFacts: string[];
  planFacts: string[];
  purchaseFacts: string[];
  supplyLineCount: number;
  purchaseLineCount: number;
}) {
  const comparedFromApproved = input.supplyLineCount === 0 && input.purchaseLineCount > 0;
  const facts = [...input.supplyFacts, ...input.planFacts, ...input.purchaseFacts].filter(
    (fact) => !comparedFromApproved || !DRAFT_WITHOUT_BOM.has(fact),
  );
  if (input.supplyLineCount > 0) {
    return { supplyLabel: input.supplyLabel, emptyNote: null as string | null, facts };
  }
  if (comparedFromApproved) {
    return {
      supplyLabel: null as string | null,
      emptyNote: "本单资料草稿没有面辅料，开裁还不能按这份草稿判断。下面按该款已批准资料比较。",
      facts,
    };
  }
  return {
    supplyLabel: input.supplyLabel,
    emptyNote: "还没有可判断的面辅料需求。",
    facts,
  };
}
