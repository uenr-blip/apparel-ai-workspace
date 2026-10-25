/** A single, unqualified “this week” means Monday–Sunday in the business timezone. */
export function currentWeekRange(text: string, now = new Date()) {
  if (!/(本周|这周|本星期|这个星期)/.test(text)) return null;
  // Leave explicit dates, subranges and comparisons to the agent instead of overriding them.
  if (/(上周|下周|上星期|下星期|未来|接下来|最近|本月|下月|周末|工作日|今天|明天|后天|剩余|剩下|去年|明年|之前|之后|不查|排除|不是|\d+\s*天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{4}[-/年]|\d{1,2}月|\d{1,2}[-/]\d{1,2})/.test(text)) return null;
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
