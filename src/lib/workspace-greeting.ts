const ZONE = "Asia/Shanghai";

const NOTES: Record<string, string[]> = {
  late: ["先把该挂的挂住，其余明天再说。", "桌上的还在，不必今晚做完。", "只留眼前这一件就好。"],
  morning: ["先看桌上两单。", "从待批开始就好。", "慢慢来，依据都在。"],
  noon: ["先把眼前这单理清。", "做对比做快更值钱。", "不必一次扫完全桌。"],
  afternoon: ["缺项还挂着，点开就行。", "还来得及把待批过掉。", "一件一件来。"],
  evening: ["今晚把该钉的钉住就好。", "不赶完所有，先做对眼前。", "先把桌上的对上，其余不急。"],
};

export function shanghaiHour(now: Date, timeZone = ZONE) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  return Number.isFinite(hour) ? hour : now.getHours();
}

export function daypartAt(now: Date, timeZone = ZONE) {
  const hour = shanghaiHour(now, timeZone);
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function notePool(hello: string) {
  if (hello === "夜深了") return NOTES.late;
  if (hello === "早上好") return NOTES.morning;
  if (hello === "中午好") return NOTES.noon;
  if (hello === "下午好") return NOTES.afternoon;
  return NOTES.evening;
}

function pickNote(name: string, now: Date, hello: string) {
  const key = `${now.toLocaleDateString("en-CA", { timeZone: ZONE })}-${shanghaiHour(now)}-${name}-${hello}`;
  let hash = 0;
  for (const char of key) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const pool = notePool(hello);
  return pool[hash % pool.length] ?? pool[0];
}

export function workspaceGreeting(name: string, now = new Date()) {
  const hello = daypartAt(now);
  const note = pickNote(name, now, hello);
  return {
    hello,
    note,
    text: `${hello}，${name}。${note}`,
  };
}
