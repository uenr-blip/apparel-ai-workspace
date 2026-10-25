import { parseArgs } from "node:util";
import { prisma } from "../src/lib/db";
import { getLoginPolicy } from "../src/lib/login-policy";
import { createPilotUser } from "../src/server/ops/pilot-user";

function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("请在交互终端运行，口令不会显示，也不接受命令行明文口令");
  process.stdout.write(prompt);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003" || char === "\u0004") { finish(new Error("已取消")); return; }
        if (char === "\r" || char === "\n") { finish(); return; }
        if (char === "\u007f" || char === "\b") value = [...value].slice(0, -1).join("");
        else if (char >= " " && Buffer.byteLength(value + char, "utf8") <= 256) value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    "list-organizations": { type: "boolean" },
    "organization-id": { type: "string" }, email: { type: "string" }, name: { type: "string" },
    role: { type: "string" }, "factory-id": { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("先配置独立试用环境。列组织：--list-organizations\n新建账号：--organization-id <ID> --email <邮箱> --name <姓名> --role salesperson|manager|factory [--factory-id <ID>]\n口令在终端隐藏输入。不修改已有账号，不重置数据库。");
    return;
  }
  if (getLoginPolicy().mode !== "pilot") throw new Error("本命令仅供独立试用环境使用");
  if (values["list-organizations"]) {
    console.table(await prisma.organization.findMany({ select: { id: true, name: true } }));
    return;
  }
  if (!values["organization-id"] || !values.email || !values.name || !["salesperson", "manager", "factory"].includes(values.role ?? "")) throw new Error("缺少组织、姓名、邮箱或明确的业务角色；使用 --help 查看说明");
  console.log(`将创建 ${values.name} / ${values.email}，角色 ${values.role}，组织 ${values["organization-id"]}。`);
  const password = await readSecret("设置至少12个字符的独立口令（不显示）：");
  if (password !== await readSecret("再次输入口令：")) throw new Error("两次口令不一致，未创建账号");
  const user = await createPilotUser({
    organizationId: values["organization-id"], email: values.email, name: values.name,
    role: values.role as "salesperson" | "manager" | "factory", factoryId: values["factory-id"],
  }, password);
  console.log(`已创建 ${user.email}，账号ID ${user.id}。创建记录已写入审计。`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : "操作失败"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
