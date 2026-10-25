# 衣据 · 服装业务工作台

衣据 / Yiju 是面向服装团队的业务工作台，覆盖开发打版、销售样、大货跟单、工厂生产与财务对账。AI 围绕业务服务查依据、准备草稿，经人工确认和服务端校验后执行并留痕。

当前为本地验证与受控试用版本，业务流程尚未经过一线人员正式操作验收，不代表生产系统已经就绪。仓库演示客户、供应商、价格和订单全部虚构。

采用 [MIT 许可证](LICENSE)。仓库名为 `apparel-ai-workspace`；仅公开源码、迁移和虚构演示 seed，不包含已有数据库、密钥、真实附件或私用工作包。

## 要求

- Node.js 20.19+（当前开发环境为 Node 24）
- npm（本仓库唯一包管理器，已提交 `package-lock.json`）

## 本地启动

以下初始化命令仅用于全新的空库。现有演示库已有业务数据及历史迁移登记差异，禁止重建、seed或直接重放全部迁移；按已核验的增量脚本办理，见 [OPS_READINESS.md](docs/OPS_READINESS.md)。

```bash
cp .env.example .env
npm ci
npm run db:setup
npm run dev
```

`db:setup` 仅初始化全新演示库，遇到已有数据库会拒绝执行，不会重置已有记录。Windows 可手动复制 `.env.example` 为 `.env`。

浏览器打开 http://localhost:3100

演示账号（仅 `DEMO_LOGIN_ENABLED=true`）：

| 角色 | 邮箱 | 密码 |
| --- | --- | --- |
| 业务员 | salesperson@demo.local | DemoPass!2026 |
| 经理 | manager@demo.local | DemoPass!2026 |
| 工厂协作员 | factory@demo.local | DemoPass!2026 |

## 主闭环（S1）

1. 登录业务员。
2. 打开「智能收件箱」，粘贴 `fixtures/06-reorder-email-en.txt` 或点「填入英文翻单邮件」。内部中文通知可用 `fixtures/01-reorder.txt`。
3. 保存并解析：系统保存原文哈希，关联已有 ST-26018，不新建主款。
4. 审核来源、未知项（尺码、罗纹规格、交期年份推断）和操作提案。
5. 批准创建草稿：事务写入订单草稿、资料 V2 草稿、内部任务。
6. 打开新订单；刷新后仍在。重复批准不会再生成订单。
7. 历史订单 `DEMO-ORD-001` 的 PO 与已批准 BOM V1 保持不变。缺少尺码/规格时不能投产。

默认 `AI_MODE=mock`、`AGENT_MODE=mock`，界面标注「演示模式，未调用真实模型」。

## Live 模式

在 `.env` 设置：

```
AI_MODE=live
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.example.com/v1
AI_API_KEY=服务端密钥
AI_MODEL=实际模型名
```

没有密钥时不要把 `AI_MODE` 设为 live。live 失败会报错，不会静默退回 mock。密钥不得进入前端、日志或 Git。

## 测试

```bash
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

测试数据库使用 `file:./prisma/test.db`，与本地 `dev.db` 分开。

## 当前限制

- 已有资料匹配、需求比较、占库与采购草稿、调拨领用、装箱和对账草稿；采购单可人工下达，投产须人工核验门槛并放行。收料和付款分开，银行实际付款未开放。
- CSV/XLSX/文字PDF有受限解析路径，视觉识款未实现；真实模型未验收，不把fixture当作真实AI能力。
- SQLite 仅本地验证，不承诺生产并发。
- 独立 worker 尚未处理 outbox；S1 解析在 Web 请求内完成。

上线前的性能、安全、数据与恢复条件见 [docs/OPS_READINESS.md](docs/OPS_READINESS.md)。生产环境拒绝演示密码登录，需要先完成正式认证方案。

Prisma相对路径基于schema目录解析：当前演示库实际文件为项目内 `prisma/prisma/dev.db`，测试库为 `prisma/prisma/test.db`。测试固定独立库路径并使用系统临时附件目录，不写演示附件。

## 材料与财务入口

- 资源中心 → 现有料：组合检索材料、颜色、地点，打开批次核对在手、占用、已登记领用及凭证。
- 设置 → 权限下发：经理给员工下发或收回调拨、领用、工厂加工对账权限，工厂范围保持隔离。
- 财务与对账 `/finance`：概览金额与状态、按工厂/状态下钻、核对加工草稿、分页查材料凭证。旧资源中心财务链接自动转入新板块。
- 外贸业务台账已开放：订单结算条件、分期应收、供应商/工厂应付、已发生收付登记、双币核销与撤回、扣补、出口单证附件和CSV导出。经理可分别下发查看与各项办理权限。
- 使用步骤与金额口径见 [TRADE_GUIDE.md](docs/TRADE_GUIDE.md)。单据确认是业务台账确认；演示账套的总账过账另经独立复核流程，真实银行交易与税务申报未开放。
- 已有本地库的本轮增量升级可用 `python3 scripts/apply_trade_migration.py /绝对路径/dev.db /独立备份目录`。此脚本先备份，拒绝重放已存在Trade表的迁移，并校验旧表记录；不能用于跳过上线迁移评审。代码生成仍使用Prisma 6。

材料收料、在途到货、退补和订单成本入口及口径见 [MATERIAL_COST_GUIDE.md](docs/MATERIAL_COST_GUIDE.md)。

退款/结汇登记、演示总账的制单→独立复核→过账→反向凭证、期间控制及试算表，见 [LEDGER_GUIDE.md](docs/LEDGER_GUIDE.md)。正式启用条件见 [OPS_READINESS.md](docs/OPS_READINESS.md)；私用环境的测试与部署记录不随开源包发布。

业务来源与总账的双向追溯、按账套记账状态、待入账及来源差异清单，见 [LEDGER_BRIDGE_GUIDE.md](docs/LEDGER_BRIDGE_GUIDE.md)。入口：财务与对账 → 记账衔接。

财务已按五个工作区域整理，首次使用从 [财务办事指南](docs/FINANCE_NAV_GUIDE.md) 开始；原业务链接保留，会计设置集中在会计账务。

业务与总账金额对照见 [MONEY_RECONCILIATION_GUIDE.md](docs/MONEY_RECONCILIATION_GUIDE.md)，可复现的整单模拟及待确认假设见 [FINANCE_SIMULATION_ACCEPTANCE.md](docs/FINANCE_SIMULATION_ACCEPTANCE.md)。

## 参与及安全

参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全边界与漏洞报告见 [SECURITY.md](SECURITY.md)。第三方依赖保留各自许可。
