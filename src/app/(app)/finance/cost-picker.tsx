"use client";
import Link from "next/link";
import { useState } from "react";
import { Lookup } from "./trade-form-parts";
import type { TradeOption } from "@/server/services/trade-lookup";
export function CostPicker(){const [order,setOrder]=useState<TradeOption|null>(null);return <div className="space-y-3"><Lookup label="选择要核对成本的订单" kind="orders" selected={order} onSelect={setOrder}/>{order?<Link href={`/finance?tab=costs&orderId=${encodeURIComponent(order.id)}`} className="inline-block rounded-xl bg-[var(--brand)] px-4 py-2 text-sm text-[var(--on-brand)]">查看本单成本</Link>:null}</div>;}
