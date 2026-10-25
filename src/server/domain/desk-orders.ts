export function isDeskOrder(input: {
  status: string;
  orderNo: string;
  hasPurchaseDraft: boolean;
}) {
  if (input.status !== "draft") return true;
  if (input.hasPurchaseDraft) return true;
  return /^DEMO-ORD-00[1-8]$/.test(input.orderNo);
}
