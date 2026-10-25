export const DEMO_CLOCK_ISO = process.env.DEMO_CLOCK ?? "2026-09-18T09:00:00+08:00";
export const DEMO_TIMEZONE = process.env.DEMO_TIMEZONE ?? "Asia/Shanghai";

export function demoNow() {
  return new Date(DEMO_CLOCK_ISO);
}

export function demoYear() {
  return Number(DEMO_CLOCK_ISO.slice(0, 4));
}

export function formatDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: DEMO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
