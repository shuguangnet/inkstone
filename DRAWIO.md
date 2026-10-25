# Draw.io 写作与 Agent 绘图

## 写作时画图

在笔记工具栏点击 **插入 Draw.io 图表**，即可使用站内 Draw.io 创建流程图、组织结构图、网络拓扑、思维导图等。填写图表名称，完成绘制后点击 **保存到笔记**。图表会直接显示在即时渲染编辑器和预览中；点击 **编辑图表** 可继续修改。沉浸模式和移动端也有插入入口。

编辑器的“文件”菜单可导入已有 Draw.io 文件。关闭未保存的绘图时会提示确认。如果笔记或同一张图表被其他客户端修改，保存会提示冲突并保留绘图窗口；可先通过 Draw.io 的“文件 → 导出为”保留当前绘图，再重新打开最新版本。

原生 XML 存在笔记的 Markdown 中，随自动保存、版本历史、同步、Markdown/ZIP 导出和 WebDAV/S3 备份保留。HTML/PDF 导出会将图表转换为 SVG 图片；公开分享页显示只读图表。Draw.io 编辑和首次渲染需要连接部署服务器；普通文字的离线编辑能力保持不变。

## 让 AI Agent 画图

Inkstone 自己的 MCP 已提供以下工具，无需额外安装 Draw.io MCP：

| 工具 | 用途 |
| --- | --- |
| `get_drawio_reference` | 获取 XML 格式、形状样式和操作说明 |
| `list_note_diagrams` | 获取指定笔记的当前 `rev`、图表 ID 和名称 |
| `read_diagram` | 分段读取图表原生 XML |
| `upsert_diagram` | 插入或更新一张图表，保留其余正文，并生成笔记版本 |

在设置中启用 MCP 和写入权限，用 OAuth 或 API Key 连接本站 `/mcp`，并让客户端重新连接以刷新工具列表。Crunchbits 端点为 `https://md.933999.xyz/mcp`。OAuth 连接需授予 `notes:read` 和 `notes:write`。

例如向 Claude Code、Codex 或其他 MCP Agent 提出：

> 在当前笔记中画一张“需求 → 设计 → 开发 → 验证”的流程图，保存为可继续编辑的 Draw.io 图表。先读取当前版本，只更新图表并保留正文。

Agent 流程：先搜索定位笔记并读取当前内容，调用 `get_drawio_reference`，再用 `list_note_diagrams` 获取最新版本。修改已有图表前调用 `read_diagram`；提交时带上该版本号和唯一操作 ID：

```json
{
  "operation_id": "a-stable-uuid-for-this-write",
  "note_id": "当前笔记的 ID",
  "expected_rev": 3,
  "diagram_id": "writing-flow",
  "title": "写作流程",
  "xml": "<mxfile><diagram name=\"Page-1\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/><mxCell id=\"a\" value=\"开始写作\" vertex=\"1\" parent=\"1\" style=\"rounded=1;whiteSpace=wrap;html=1;\"><mxGeometry x=\"40\" y=\"40\" width=\"160\" height=\"60\" as=\"geometry\"/></mxCell></root></mxGraphModel></diagram></mxfile>"
}
```

同一 `diagram_id` 更新原图，不存在时追加新图。`expected_rev` 过期时必须重新读取并合并；仅完全相同的重试复用 `operation_id`。提交后用 `read_diagram` 验证结果。XML 限制为 512 KiB，非压缩 XML 最多 10,000 个单元，禁止 DTD 和实体声明。

需要更多形状检索时，可自行给 Agent 增加[官方 Draw.io MCP](https://github.com/jgraph/drawio-mcp)，其托管地址为 `https://mcp.draw.io/mcp`。这是可选的独立服务，使用时会把所提交的图表数据发送给该服务；Inkstone 不会自动连接它。Agent 从其获取 XML 后仍需调用 Inkstone 的 `upsert_diagram` 保存至笔记。

## 存储格式

````markdown
```drawio id=writing-flow title=%E5%86%99%E4%BD%9C%E6%B5%81%E7%A8%8B
<mxfile>...</mxfile>
```
````

图表 ID 在一篇笔记内应保持唯一。支持 `mxfile`（含 Draw.io 自身保存的压缩内容）和 `mxGraphModel`。其他 Markdown 阅读器可能将其显示为代码块；可将 XML 复制到 Draw.io 打开。

## 部署与开发

Docker Compose 内置固定版本的官方 `jgraph/drawio` 服务，由网关代理 `/drawio/*`。更新后执行：

```bash
docker compose up -d --build
# Caddyfile 使用 admin off，升级已有网关时需重启以加载新增代理路径：
docker compose restart gateway
```

用户无需填写地址、令牌或另行启动绘图服务。Draw.io 不开放宿主机端口；网关向绘图服务转发时移除 Inkstone 的 Cookie 和 Authorization。绘图和查看器脚本均由同一部署提供，展示 XML 的查看器在独立沙箱 iframe 中运行。

`DRAWIO_BASE_URL=/drawio` 会改变官方容器的 Tomcat 上下文，代理必须保留 `/drawio/` 前缀。该服务设置 640 MiB 内存上限，已有部署需预留相应资源。Cloudflare Workers 部署者需在同一站点单独代理一个 Draw.io 服务到 `/drawio/`；Workers 本身不能运行此 Docker 容器。

本地开发可将容器映射到 `127.0.0.1:17813` 并设置 `DRAWIO_BASE_URL=/drawio`，Vite 默认代理到该地址；也可通过 `INKSTONE_DRAWIO_DEV_URL` 指向自己的 Draw.io 服务。查看器所用静态资源需要允许不携带凭据的跨源读取（生产网关已设置），以支持不具有同源权限的沙箱。
