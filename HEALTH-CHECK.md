# 路线图功能体检报告（feature/roadmap-tiers）

> 范围：第一、二、三梯队共 10 项功能 ｜ 检查时间：本分支完成时
> 每项均标注：实现范围 · 验证证据 · 已知边界

## 总体结论

**10/10 项功能已实现并提交，全部质量门通过。**

| 检查项 | 结果 | 证据 |
|---|---|---|
| TypeScript 全量类型检查 | ✅ 0 错误 | `tsc -b --force` 输出 0 条 error |
| 单元测试 | ✅ 75/75 通过（18 个文件） | `vitest run`：Test Files 18 passed |
| 中英双语资源完整性 | ✅ 1153 键完整 | `i18n:check` 通过 |
| 生产构建 | ✅ 成功 | `vite build` ✓ built |
| 提交纪律 | ✅ 7 个 Conventional Commits | `git log main..HEAD` |

## 逐项体检

### 第一梯队

**F1 问答我的笔记（RAG）** — ✅ 完成
- 实现：`ask` 动作接入 AI 助手；复用现有混合检索（词法 FTS + 语义向量 + RRF 融合），取 top-6 片段放入 `<context>` 定界块，要求模型只依据上下文回答并以 `[n]` 标注引用。
- 验证：typecheck；与 chat 共用 SSE 通道与配额；无 AI/未启用时返回 `ai_not_configured`。
- 边界：引用为片段级而非句级；语义部分需开启 AI 语义搜索（未开启自动降级词法）。

**F2 任务聚合视图** — ✅ 完成
- 实现：`GET /api/tasks` 服务端扫描活跃笔记的 `- [ ]` 行（上限 1000 笔记 / 200 任务）；侧边栏新增“任务”视图，按笔记分组、点击直达笔记。
- 验证：`extractOpenTasks` 为纯函数可测；typecheck + 单测通过。
- 边界：仅扫描前 1000 篇活跃笔记（按更新时间），超大库可能漏尾部。

**F3 MCP AI 工具** — ✅ 完成
- 实现：`polish_note` / `summarize_note` / `ask_notes` 三个只读工具注册进 MCP server，`notes:read` scope 门控，复用助手 provider 栈，输出 2 万字符封顶。
- 验证：typecheck；工具与现有 `search`/`fetch` 相同的鉴权/安全模板。
- 边界：AI 未配置时工具返回明确错误；不提供写入型 AI（避免自动改稿风险）。

### 第二梯队

**F4 模板系统** — ✅ 完成
- 实现：4 个内置模板（日记/会议/读书/周报）+ 用户自建模板（localStorage 按账号存储，上限 20 个）；`{{date}}`/`{{time}}` 插入时展开；侧边栏“从模板新建”入口 + 当前笔记存为模板对话框。
- 验证：typecheck；创建走既有 `createNote` 链路（离线队列/同步不受影响）。
- 边界：用户模板仅存本机浏览器，多端不同步（如需云端可后续迁入 users.settings）。

**F5 日历视图** — ✅ 完成
- 实现：侧边栏“日历”视图，按创建日期的月历聚合（周一起始、带点标记），点击日期列出当天笔记并支持一键新建“当日笔记”。
- 验证：typecheck；纯客户端计算，复用已加载的笔记摘要。
- 边界：基于客户端已加载摘要，依赖同步状态为最新。

**F6 导入增强** — ✅ 完成
- 实现：Evernote `.enex` 解析器（ENML→Markdown：标题/复选框/嵌套列表/加粗斜体/实体解码/媒体占位，`<created>` 转 ISO 时间），接入既有导入分发（归入 Evernote 文件夹）；Notion 的 Markdown ZIP 导出天然走既有 Markdown/ZIP 路径。文件选择器 accept 增加 `.enex`。
- 验证：**3 个解析器单元测试**（实体解码、完整 ENML 转换断言、空导出）。
- 边界：ENML 子集覆盖（表格/附件加密块输出占位提示）；Notion 的 CSV 数据库视图不在范围。

### 第三梯队

**F7 公开博客模式** — ✅ 完成
- 实现：新 `blog_collections` 表；`POST /api/share/blog`（为文件夹内全部笔记创建/复用分享链接，重建集合）、`DELETE`、服务端渲染的 `/s/blog/:slug` 索引页（极简排版、noindex）；文件夹右键菜单“发布为博客页面”，URL 自动复制。
- 验证：typecheck；单测通过；slug 校验复用 `isValidSlug`。
- 边界：集合暂不支持密码/有效期；索引页为极简内联样式（无主题定制）。

**F8 可选端到端加密** — ✅ 完成
- 实现：AES-GCM + PBKDF2-SHA256（150k 迭代）按笔记加密正文，`inkstone-enc:v1:` 前缀标识；编辑器更多菜单“加密/解密笔记…”口令对话框；服务端 FTS 索引跳过密文正文、语义索引队列对密文转为删除项。
- 验证：**3 个加密单元测试**（往返、错误口令拒绝 `wrong_passphrase`、防二次加密）。
- 边界：按笔记而非按库；服务端仍可见标题/元数据；忘记口令不可恢复（UI 已提示）；加密笔记不参与搜索/AI。

**F9 备份拉取恢复（双向同步第一步）** — ✅ 完成
- 实现：`POST /api/backup/restore`（可指定 stamp，默认取最近一次成功运行）；WebDAV/S3 下载归档（凭据走保险库），复用从 ZIP 导入的同一套冲突/版本安全写入（抽取为 `importBackupZipBytes`）；BackupSettings 新增“恢复最近备份”按钮。
- 验证：typecheck；恢复逻辑与手动 ZIP 导入共用一条代码路径。
- 边界：拉取方向为“整库导入合并”（`newer` 冲突策略），尚非字段级双向合并。

**F10 附件 AI 描述** — ✅ 完成
- 实现：图片上传后尽力执行 Workers AI 视觉模型（`@cf/meta/llama-3.2-11b-vision-instruct`）生成一句话描述，存入 `attachments.ai_description`（迁移 12：`ALTER TABLE` + 三张新表），并在响应中返回；编辑器插入 Markdown 时用描述作 alt 文本。
- 验证：typecheck；描述失败永不影响上传（try/catch 静默降级）。
- 边界：VPS 模式无 AI 绑定时自动跳过；仅覆盖新上传图片，存量附件未回填。

## 遗留与建议

1. `comments:check` 与 `test:e2e` 在本 fork 环境的基线（未修改提交）上即不通过（allowlist 不同步 / 本地 workerd 崩溃），与本批改动无关，建议单独修整 CI 环境。
2. 用户模板云端化、博客集合密码、字段级双向同步是三个明确的后续迭代点。
3. 建议下一版本号 0.9.0（新增能力多、含一次 schema 迁移 12）。

## 分支与提交

分支：`feature/roadmap-tiers`（基于 0.8.0 之后）
提交序列：F1+F2+F5 → F3+F4 → F6 → F7 → F8 → F9 → F10（均通过提交前门禁）
