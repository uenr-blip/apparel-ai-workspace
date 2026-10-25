import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { InboxAttachmentError, readInboxAttachment } from "@/server/services/inbox-attachment";

export async function GET(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!["salesperson", "manager"].includes(session.role)) return NextResponse.json({ error: "当前角色不能查阅客户原件" }, { status: 403 });
  const { sourceId } = await context.params;
  try {
    const file = await readInboxAttachment({ organizationId: session.organizationId, sourceId });
    return new NextResponse(Uint8Array.from(file.bytes), {
      headers: {
        "Content-Type": file.mime,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${file.filename ?? "attachment"}"`,
      },
    });
  } catch (error) {
    const message = error instanceof InboxAttachmentError ? error.message : "读取失败";
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
