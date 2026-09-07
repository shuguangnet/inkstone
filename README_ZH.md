<p align="center">
  <img src="./public/inkstone-logo.svg" width="112" height="112" alt="Inkstone 项目 Logo" />
</p>

<h1 align="center">Inkstone</h1>

<p align="center">
  一套用于写作、整理、同步和备份个人知识的自托管 Markdown 笔记应用。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./CONTRIBUTING.md">参与开发</a> ·
  <a href="./LICENSE">LGPL-3.0-only</a> ·
  <a href="https://inkstone-demo.pages.dev/">在线体验</a>
</p>

## 项目简介

Inkstone 是一套可运行在 Cloudflare Workers 上，也可通过 Docker 私有化部署到自有 VPS 的浏览器笔记本。笔记始终是普通 Markdown 文本；在此基础上，应用提供专注写作、实时预览、关键词与可选语义搜索、双链导航、离线编辑、多设备同步、私有 AI 接入、公开分享和异地备份。

它是一套需要自行部署的完整应用，数据库、附件和运行环境都由部署者掌控。

每个新账号都会自动获得中文版和英文版两篇标准起始笔记。纯前端体验版复用同一份笔记内容，刷新页面后恢复为这两篇起始笔记，不会另外维护一套示例数据。


## 主要功能

| 范围 | 已实现能力 |
| --- | --- |
| 写作 | CodeMirror 6 编辑器、可独立编辑的笔记标题、**桌面双笔记窗格**、各窗格独立的编辑/分栏/预览布局、双向滚动、大纲、**专注模式**、**打字机模式**、**自动保存**、**版本历史** |
| Markdown | GFM 表格与任务列表、脚注、Obsidian 风格注释、WikiLink、嵌入、块 ID、Callout、折叠块、标签页、**数学公式**、**Mermaid**、**PrismJS 代码高亮**、**Front Matter** |
| 整理 | 支持拖拽排序的多级文件夹、正文标签、收藏、置顶、归档、回收站、**Wiki 双链**、反向链接、块引用、笔记嵌入、关系图谱 |
| 搜索 | 基于 D1 FTS5 的全**文搜索**、中文索引、条件筛选、最近笔记、命令面板，以及由 Workers AI 提供的可选私有**语义/混合搜索** |
| **MCP** | 私有远程 MCP、带 PKCE 的 OAuth 2.1、可撤销的 `ink_...` API Key、标准 `search`/`fetch`、分段读取、版本安全写入、独立回收站权限和账号级授权管理 |
| 可靠性 | 可安装 PWA、离线启动、浏览器本地缓存、**离线写入队列与乐观并发控制**、常用操作立即本地生效并可失败回滚、过期同步保护、冲突副本、实时通知和主标签页轮询降级 |
| 分享 | 可设置访问口令和有效期的公开笔记链接 |
| 可迁移性 | JSON 与 ZIP 导出、可直接阅读的 **Markdown**、附件导出、**手动或定时 WebDAV/S3 备份** |
| 界面 | **桌面与移动布局**、**深浅主题**、强调色、简体中文和英文，以及仅站长可见的版本更新提醒 |

## 私有化部署方式

两种部署方式都属于自托管，应用数据均由部署者控制。

| | Cloudflare 部署 | Docker VPS 私有化部署 |
| --- | --- | --- |
| 运行环境 | Cloudflare Workers | Docker Compose 中的本地 workerd 运行时 |
| 持久化数据 | 托管 D1、R2 或 KV、Durable Objects | 本地 D1、KV 和 Durable Object 状态，统一保存在 Docker 卷中 |
| 访问方式 | Workers 域名或自定义域名 | 自有 HTTPS 反向代理和域名 |
| 搜索能力 | FTS5 关键词搜索，可选 Workers AI 语义搜索 | FTS5 关键词搜索，不支持 Workers AI |
| 运维责任 | Cloudflare 管理运行时和存储服务 | 自行管理 VPS、升级、卷备份、TLS 和监控 |
| 扩容方式 | Cloudflare 托管平台 | 单节点、单应用副本 |

Docker 模式不需要 Cloudflare 账号，也不依赖 Cloudflare 托管存储。它可以部署在公网 VPS、私有网络或家庭服务器中，但客户端必须通过固定的 HTTPS 地址访问。

## 数据存放位置

| 数据 | Cloudflare 部署 | Docker VPS 部署 |
| --- | --- | --- |
| 账号、笔记、文件夹、标签、设置、版本、分享和 FTS 索引 | Cloudflare D1 | 持久化 `inkstone_data` 卷中的本地 D1 状态 |
| 附件和上传头像 | Cloudflare R2 或 Workers KV | 持久化卷中的本地 KV 状态 |
| MCP OAuth 注册、令牌和授权记录 | Workers KV `OAUTH_KV` | 持久化卷中的本地 KV 状态 |
| 实时同步与备份密钥加密存储 | `SyncHub` 和 `CredentialVault` Durable Objects | 持久化卷中的本地 Durable Object 状态 |
| 语义搜索向量 | 可选 Workers AI 绑定 | 不支持；关键词搜索仍可正常使用 |
| 离线缓存与待上传写入 | 浏览器 IndexedDB | 浏览器 IndexedDB |
| 异地备份 | 用户配置的 WebDAV 或 S3 兼容存储 | 用户配置的 WebDAV 或 S3 兼容存储 |

## 部署教程

可选择 Cloudflare 或 Docker VPS 方式。两种模式都会通过带版本号、可重复安全执行的迁移自动升级现有数据库，更新前应保留一份最新备份。

### Cloudflare 部署

1. Fork Inkstone 仓库到自己的 GitHub 账号
2. 进入 [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)
3. 选择 Continue with GitHub 并选择你的仓库
4. 使用 R2 时，构建命令填 `npm run build`，部署命令填 `npm run deploy`
   - 如果你打算用 KV 模式，把部署命令改成 `npm run deploy:kv`
5. 等部署完成后，打开生成的 Workers 域名

发现新的稳定版本时，只有站长会收到专门的更新提醒，不会打扰普通成员。

### Docker VPS 私有化部署

环境要求：

- 安装了 Docker Engine 和 Docker Compose 的 Linux VPS 或服务器
- 建议至少 2 核 CPU、2 GB 内存和 5 GB 可用磁盘
- 一个域名或私有 DNS 名称，并通过 Caddy、Nginx、Traefik 等反向代理提供 HTTPS

快速启动：

```bash
git clone https://github.com/shuguangnet/inkstone.git
cd inkstone
cp .env.example .env
sed -i "s/^INKSTONE_SCHEDULE_TOKEN=.*/INKSTONE_SCHEDULE_TOKEN=$(openssl rand -hex 32)/" .env
```

将 `.env` 中的 `INKSTONE_PUBLIC_URL` 设置为浏览器实际使用的 HTTPS 地址，然后启动服务：

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:7712/api/health
```

Compose 会启动应用服务、定时维护任务和只监听回环地址的内部网关。内部计划任务端点不会暴露到公网，应用容器会移除全部 Linux capabilities，网关使用只读文件系统；替换或升级容器后，全部应用状态仍保存在命名 Docker 卷中。

Docker VPS 模式支持账号、笔记、文件夹、标签、附件、公开分享、MCP、实时同步、离线编辑、ZIP/JSON 导出和定时 WebDAV/S3 备份。该模式不提供 Workers AI 语义搜索、Cloudflare 分布式可用性和水平扩容能力，只能运行一个应用副本，并应将 `inkstone_data` 卷纳入 VPS 备份策略。

Compose 部署、升级、备份和安全说明见 [VPS_DOCKER_ZH.md](./VPS_DOCKER_ZH.md)。

## 导出与备份

- JSON 导出保留可重新导入的旧版结构化笔记数据。
- ZIP 导出与远程备份使用同一套可校验的 Markdown 快照，包含可读正文、归档笔记、回收站笔记、附件和完整性标记。
- 远程备份支持 WebDAV 与 S3 兼容存储，同一快照内内容相同的附件只保存一份。
- 大型备份可直接选择备份文件夹分批恢复，不必把整包一次装入内存。
- 可以配置多个目标，并选择手动执行或定时运行。
- 登录密码、活动会话、分享口令和备份服务凭据不会进入导出文件。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地 Worker 和前端 |
| `npm run dev:kv` | 使用 KV 附件配置启动本地环境 |
| `npm run dev:demo` | 启动刷新即重置的纯前端体验版 |
| `npm run typecheck` | 执行 TypeScript 项目检查 |
| `npm run test:unit` | 运行 Vitest 单元测试 |
| `npm run i18n:check` | 检查中英文资源键是否完整一致 |
| `npm run comments:check` | 检查源码注释规范 |
| `npm run build` | 类型检查并生成生产构建 |
| `npm run build:vps` | 类型检查并生成本地 workerd 生产构建 |
| `npm run start:vps` | 使用本地持久化状态运行已经构建的 VPS 服务 |
| `npm run deploy:kv` | 使用 `wrangler.kv.toml` 构建并部署 |
| `npm run deploy:demo` | 构建并部署纯静态体验版 |
| `npm run test:e2e` | 对正在运行的临时本地实例执行 API 端到端测试 |

端到端脚本会在 `http://localhost:7712` 创建、修改并删除数据，只能对专门用于测试的全新本地状态运行。

## 目录结构

```text
src/
├── client/   React 界面、编辑器、预览和本地状态
├── shared/   共享类型、限制、语言资源和 Markdown 工具
└── worker/   Hono API、认证、D1 访问、同步、分享和备份
public/       静态资源
scripts/      仓库检查与端到端验证脚本
tests/        跨模块回归测试
```

## 安全与参与开发

报告安全问题前请阅读 [`SECURITY.md`](./SECURITY.md)。开发环境和贡献要求见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可证

Inkstone 使用 [GNU Lesser General Public License v3.0 only](./LICENSE)，SPDX 标识为 `LGPL-3.0-only`。
