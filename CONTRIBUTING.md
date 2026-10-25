# 参与衣据

请先按 README 在独立目录建立虚构演示库。不要在真实业务数据库上调试或运行初始化。

- 说明可复现的问题、预期行为和修改范围；截图及日志须先移除客户资料和密钥。
- 业务规则见 AGENTS.md、docs/ACCEPTANCE.md 和 docs/DECISIONS.md。流程仍待一线正式验收。
- 修改业务流程时同步检查服务、智能体工具、上下文版本和相关验收用例，保留人工确认、权限、审批、幂等和审计。
- 使用 npm 和锁文件，保持 Prisma 6。Next.js API 以安装版本的 node_modules/next/dist/docs 为准。
- 提交前执行相关测试、npm run typecheck 和 npm run lint；界面或构建改动另检查 E2E / build，并如实说明未完成项。
- 不提交 .env、数据库、真实附件、备份、日志或个人会话记录。测试数据必须虚构。

本项目采用 MIT 许可；引入第三方代码或素材时保留其许可与来源。
