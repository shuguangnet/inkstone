# 沉浸式写作与服务器 AI 终端

编辑器默认启用“即时渲染”：完成 Markdown 输入后，标题、粗体、斜体、删除线、高亮、链接、引用和列表直接显示排版效果；表格、图片、代码块和公式在原位预览。点击预览内容即可编辑，任务复选框可直接勾选并撤销。工具栏的“显示 Markdown 源码”按钮可随时切换，偏好也可在编辑器设置中调整。原始 Markdown、快捷键、自动保存及 AI/终端导出保持兼容。新账号默认单栏写作，已有账号保留布局偏好。

## 实施计划及首版范围

1. 沉浸式写作：隐藏导航、笔记列表、格式工具栏和第二窗格，正文居中；保留自动保存，提供段落聚焦与打字机开关。Ctrl/Cmd+Shift+E 进入，Esc 退出，退出后恢复原有布局。
2. 服务器终端：真实 PTY + xterm.js；独立 Node 连接服务与 Worker 分开部署，由 HTTPS/WSS 代理接入；校验站点 Origin，并通过 Inkstone 现有站长登录会话鉴权。
3. 写作闭环：编辑器、命令面板和 AI 面板提供终端入口；一键导出当前最新正文到服务器 Markdown，启动 Claude Code / Codex / PyAgent / DSH 或自定义命令，引入文件路径；读取修改、预览差异、检测冲突、确认写回。
4. 验证：真实交互终端、连接鉴权、文件边界、写回保护、类型检查、中英文检查和生产构建。

## 快速启动（在 Inkstone 部署服务器上）

需要 Node.js 24.15+、npm，以及已安装并登录的 CLI。使用专门的普通用户运行连接服务。Linux 安装 node-pty 时需要 Python 3、make 和 C++ 编译器。

```bash
npm ci
npm run terminal:local -- --origin https://你的Inkstone域名
```

服务只监听 `127.0.0.1:31789`。默认向本机 `http://127.0.0.1:7712/api/terminal/authorize` 验证站长登录状态；应用端口不同时，可用 `--authorize-url` 指定本机鉴权地址。终端运行在启动服务的用户环境中，不自动安装 CLI。

在服务器外层的 Caddy HTTPS 站点内增加以下规则，并保留已有 Inkstone 反向代理：

```caddyfile
notes.example.com {
    handle_path /writing-terminal/* {
        reverse_proxy 127.0.0.1:31789
    }
    handle {
        reverse_proxy 127.0.0.1:7712
    }
}
```

`handle_path` 会将 `/writing-terminal/terminal` 转成连接服务使用的 `/terminal`，Caddy 自动转发 WebSocket 升级请求。若 Caddy 在容器中，`127.0.0.1` 指容器自身，需要通过受限的宿主机网络接入；此规则应添加到能访问宿主机回环地址的外层代理。连接服务无需修改现有应用容器和数据卷。

浏览器登录站长账号，打开笔记后点击“服务器终端”即自动连接，无需填写地址、令牌或运行命令。断开后点击“唤醒终端”可重连。连接地址自动使用当前站点；连接服务在 WebSocket 握手时向 Inkstone 验证 HttpOnly 会话 Cookie，未登录、登录失效和普通成员均无法连接。鉴权服务不可用时拒绝连接，不回退到免鉴权模式。

可以重复传入 `--origin` 允许多个明确站点；`--port` 修改端口，`--workspace` 指定工作目录（默认 `~/.inkstone/writing`）。Origin 只包含协议、域名及可选端口，不包含路径或尾部 `/`。

## systemd 部署示例

仓库提供 [服务模板](docker/inkstone-terminal.service)。以下命令假设仓库已复制到 `/opt/inkstone` 并完成 `npm ci`，且 `/usr/bin/node` 为 Node.js 24.15+。按实际环境调整模板中的路径。

```bash
sudo useradd --system --create-home --home-dir /var/lib/inkstone-terminal --shell /bin/bash inkstone-terminal
sudo install -d -o inkstone-terminal -g inkstone-terminal -m 700 /var/lib/inkstone-terminal/writing
sudo install -m 644 docker/inkstone-terminal.service /etc/systemd/system/inkstone-terminal.service
sudo sh -c 'echo INKSTONE_TERMINAL_ORIGIN=https://notes.example.com > /etc/inkstone-terminal.env'
sudo chmod 600 /etc/inkstone-terminal.env
sudo systemctl daemon-reload
sudo systemctl enable --now inkstone-terminal
sudo journalctl -u inkstone-terminal -n 20 --no-pager
```

服务开机自动启动，用户通过网站点击即可唤醒终端。重启服务会结束已有会话，重新点击即可连接。模板使用专用用户和私有 HOME，CLI 应安装到 `/var/lib/inkstone-terminal/.local/bin` 或模板 PATH 下并以该用户登录；现有 root 用户的 CLI 配置不会被继承。模板限制文件写入到 `/var/lib/inkstone-terminal`，如工具需要其他工作目录，应明确调整 `ReadWritePaths`。不要把密码或 API Key 提交到仓库。

## 写作流程

- “保存当前笔记到服务器”导出编辑器中的最新正文（包含尚未同步的编辑）。每次创建独立文件，避免覆盖之前的 CLI 修改；文件名包含笔记 ID 和快照 ID。
- 选择工具并点“启动工具”，命令可修改，PyAgent 和 DSH 按服务器实际安装的启动命令配置。CLI 在工作目录运行，使用自己的账号、模型配置和计费。
- “引入文件路径”仅插入经过 shell 引用的文件绝对路径，不自动发送回车；可组合自己的提示词，也可手动使用工具的 `@文件` 语法。工具已经启动时，直接在其提示框继续输入。
- CLI 修改 Markdown 后，点“读取文件修改”，查看差异，再点“应用到笔记”。只更新正文，后续沿用 Inkstone 的自动保存、同步和版本历史。
- 导出后若编辑器内容变化，写回会被阻止。先保留改动并重新导出，再让 CLI 合并。切换笔记会清空文件关联和导入预览；终端会话保留。
- 大文档使用有界正文预览，避免逐行差异占用过多内存。单个文件限制为 2 MiB，每个会话最多导出 100 个快照，同时最多 4 个连接。
- 关闭面板、断开连接或退出 shell 会结束对应终端进程；文件保留，供后续人工整理。重连需重新导出笔记。

## 部署边界

Cloudflare Worker 不执行命令，独立服务在 Inkstone 服务器运行；前端构建仍支持 Cloudflare 和 VPS。服务器 shell 具有服务用户的操作权限，连接服务并非操作系统沙箱。文件接口只读取当前连接创建的笔记快照，终端内的 CLI 可以按操作系统权限自行访问其他文件。首版使用手动导出和确认写回，不提供无人值守双向同步、自动安装 CLI 或终端会话恢复。

验证命令：`npm run test:terminal`、`npm run test:unit`、`npm run typecheck`、`npm run i18n:check`、`npm run build:vps`。
