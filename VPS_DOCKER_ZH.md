# 使用 Docker 部署到 VPS

该模式使用 Wrangler 管理的本地 workerd 运行已经构建好的 Inkstone Worker。D1、KV、附件、OAuth 状态和 Durable Object 数据统一保存在 Docker 持久化卷中。

## 环境要求

- 安装了 Docker Engine 和 Docker Compose 的 Linux VPS
- 建议至少 2 核 CPU、2 GB 内存和 5 GB 可用磁盘
- 一个域名，并通过 Caddy、Nginx、Traefik 等反向代理提供 HTTPS
- 只运行一个应用副本；本地状态卷不支持水平扩容

该模式无法使用 Workers AI，因此语义搜索会保持关闭。关键词全文搜索、附件、MCP、公开分享、WebDAV 备份和 S3 备份仍可使用。

## 启动服务

```bash
git clone https://github.com/shuguangnet/inkstone.git
cd inkstone
cp .env.example .env
sed -i "s/^INKSTONE_SCHEDULE_TOKEN=.*/INKSTONE_SCHEDULE_TOKEN=$(openssl rand -hex 32)/" .env
```

编辑 `.env`，填写对外 HTTPS 地址：

```dotenv
INKSTONE_PUBLIC_URL=https://notes.example.com
INKSTONE_PORT=7712
INKSTONE_APP_NAME=Inkstone
INKSTONE_LOG_LEVEL=info
INKSTONE_SCHEDULE_TOKEN=自动生成的随机值
```

`INKSTONE_PUBLIC_URL` 必须与浏览器实际访问地址一致，它用于安全 Cookie、公开分享链接和 MCP OAuth 元数据。

构建并启动：

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:7712/api/health
```

Compose 包含三个服务：

- `app`：在本地 workerd 中运行构建后的 Worker，状态持久化到 `/data`
- `scheduler`：在 UTC 时间每小时的 `00`、`15` 和 `45` 分钟触发原有 Cloudflare Cron 任务
- `gateway`：只监听 `127.0.0.1:7712`，并阻止公网访问内部计划任务端点

## 配置 HTTPS

内置网关只监听回环地址，需要让 VPS 上的反向代理连接该端口。

Caddy 示例：

```caddyfile
notes.example.com {
  reverse_proxy 127.0.0.1:7712
}
```

Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_pass http://127.0.0.1:7712;
    }
}
```

不要直接对外暴露 `app` 服务或内部计划任务端点。

## 升级

先创建最新的 Inkstone 备份，再拉取并重新构建：

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:7712/api/health
```

首次请求会自动执行数据库迁移。

## 备份与恢复

建议使用 Inkstone 内置的 WebDAV 或 S3 备份生成可迁移的 Markdown 快照。同时应将 `inkstone_data` Docker 卷纳入 VPS 备份，因为其中包含账号、会话、设置、附件和本地运行状态。

创建底层文件系统快照前先停止写入：

```bash
docker compose stop gateway scheduler app
```

卷快照完成后重新启动：

```bash
docker compose start app scheduler gateway
```

恢复卷快照时也必须先停止全部三个服务。

## 日常操作

```bash
docker compose logs -f app
docker compose logs -f scheduler
docker compose restart app
docker compose down
```

`docker compose down` 会保留命名数据卷。除非确定要删除全部本地 Inkstone 数据，否则不要添加 `--volumes`。

## 安全说明

- 保持发布端口绑定在 `127.0.0.1`，只通过 HTTPS 暴露 Inkstone。
- 不要把 `.env` 提交到 Git，并限制只有部署管理员可以读取。
- 定期备份持久化卷并实际测试恢复流程。
- 这是单机运行模式，不具备 Cloudflare 的分布式可用性、托管存储耐久性和 Workers AI 能力。
