import { labels } from "@/lib/labels";

const SPEC_KINDS = new Set(["missing_size_breakdown", "missing_delivery_year", "missing_rib_spec"]);
const FABRIC_KINDS = new Set(["late_material_risk", "material_test_pending"]);
const COLOR_KINDS = new Set(["missing_approval"]);

export type OrderWatch = {
  spec: string[];
  fabric: string[];
  colorCard: string[];
};

export function classifyOrderWatch(
  tasks: Array<{ kind: string }>,
  readiness: string,
): OrderWatch {
  const spec = uniqueLabels(tasks.filter((task) => SPEC_KINDS.has(task.kind)).map((task) => labels.taskKind(task.kind)));
  const fabric = uniqueLabels(tasks.filter((task) => FABRIC_KINDS.has(task.kind)).map((task) => labels.taskKind(task.kind)));
  const colorCard = uniqueLabels(tasks.filter((task) => COLOR_KINDS.has(task.kind)).map((task) => labels.taskKind(task.kind)));
  if (readiness === "blocked_material" && fabric.length === 0) fabric.push("材料未齐");
  if (readiness === "blocked_color_approval" && colorCard.length === 0) colorCard.push("颜色确认未通过");
  return { spec, fabric, colorCard };
}

function uniqueLabels(values: string[]) {
  return [...new Set(values)];
}
