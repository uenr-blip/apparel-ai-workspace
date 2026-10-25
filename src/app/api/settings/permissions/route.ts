import { getSession } from "@/lib/auth";
import { setUserPermission } from "@/server/services/user-permissions";
import { z } from "zod";
const Input = z.object({ targetUserId: z.string().min(1).max(120), action: z.string().max(80), enabled: z.boolean() });
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  if (session.role !== "manager") return Response.json({ error: "只有经理可以管理权限" }, { status: 403 });
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "请选择员工和权限" }, { status: 400 });
  try {
    return Response.json(await setUserPermission({ organizationId: session.organizationId, managerId: session.id, ...parsed.data }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "权限更新失败" }, { status: 400 });
  }
}
