import { NextResponse } from "next/server";
import { tradeSession, tradeHttpError } from "@/server/services/trade-http";
import { constructionForm } from "@/server/services/style-construction-http";
import { saveStageMaterials } from "@/server/services/workflow-stage";
import { ExecutionError } from "@/server/services/execution";
import { ZodError } from "zod";
export async function POST(request: Request) {
  try {
    const actor = await tradeSession(), { form, rows, uploads } = await constructionForm(request);
    return NextResponse.json(await saveStageMaterials(actor, { target: JSON.parse(String(form.get("target"))), expectedStamp: String(form.get("expectedStamp") || ""), rows, uploads, reason: String(form.get("reason") || ""), ownerId: String(form.get("ownerId") || ""), requestKey: String(form.get("requestKey") || "") }));
  } catch (e) { if (e instanceof ExecutionError || e instanceof ZodError) return NextResponse.json({ error: e instanceof ZodError ? e.issues[0]?.message : e.message }, { status: 400 }); return tradeHttpError(e); }
}
