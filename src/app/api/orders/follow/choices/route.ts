import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET(){const u=await getSession();if(!u || !["manager","salesperson"].includes(u.role))return NextResponse.json({error:"无权读取"},{status:403});const [customers,factories]=await Promise.all([prisma.customer.findMany({where:{organizationId:u.organizationId,archivedAt:null},select:{id:true,name:true},orderBy:{name:"asc"}}),prisma.party.findMany({where:{organizationId:u.organizationId,kind:"factory",archivedAt:null},select:{id:true,name:true},orderBy:{name:"asc"}})]);return NextResponse.json({customers,factories},{headers:{"Cache-Control":"no-store"}});}
