export function blockingTaskHref(kind: string, orderId: string) {
  if (kind === "missing_approval") return `/orders/${orderId}#color-confirm`;
  if (kind === "missing_size_breakdown" || kind === "missing_rib_spec") return `/orders/${orderId}#size-matrix`;
  if (kind === "missing_delivery_year") return `/orders/${orderId}#delivery-year`;
  return `/orders/${orderId}`;
}
