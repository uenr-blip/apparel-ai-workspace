export async function POST() {
  return Response.json({
    ok: true,
    note: "S1 解析在请求内完成。独立 worker 将在 S4 事件闭环中启用，当前没有后台假监控。",
  });
}
