import { demoYear } from "@/lib/clock";

function pad(value: string) {
  return value.padStart(2, "0");
}

export function suggestedDeliveryDate(text: string | null | undefined, year = demoYear()): string | null {
  if (!text) return null;
  const compact = text.replace(/\s/g, "");
  const chinese = compact.match(/(\d{1,2})月(\d{1,2})日/);
  if (chinese) return `${year}-${pad(chinese[1]!)}-${pad(chinese[2]!)}`;
  const english = text.match(/(\d{1,2})\s+October|October\s+(\d{1,2})/i);
  const day = english?.[1] ?? english?.[2];
  if (day) return `${year}-10-${pad(day)}`;
  return null;
}
