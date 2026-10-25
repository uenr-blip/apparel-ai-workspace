import { FollowNavigationScope } from "@/components/navigation-scope";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getFollowChangeBoard } from "@/server/services/follow-change";
import { ChangeForm } from "./form";
export default async function Page({params}:{params:Promise<{id:string}>}){const u=await requireSession();if(!["salesperson","manager"].includes(u.role))notFound();const id=(await params).id;const board=await getFollowChangeBoard({organizationId:u.organizationId,userId:u.id,role:u.role},id);return <div className="space-y-5"><FollowNavigationScope kind={board.kind} /><PageHeader eyebrow="订单修订" title={`${board.title} · 客户改单`} description="登记客户要求 → 负责人核对影响 → 主管确认 → 回查生产与总表" actions={<Link className="underline" href={`/orders/follow/${id}`}>返回跟单</Link>} /><Card className="sheet-pad"><ChangeForm board={board} manager={u.role==="manager"} /></Card></div>;}
