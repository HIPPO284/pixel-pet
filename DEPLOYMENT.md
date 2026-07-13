# 部署说明

## 推荐部署类型

本版本需要持久化 SQLite 文件，因此适合：

- 一台 Linux VPS
- Railway / Render / Fly.io 等支持持久磁盘的 Node 服务
- Docker 主机或 NAS

不适合把后端直接部署成无持久磁盘的纯静态站点或短生命周期 Serverless Function。

## 直接运行

```bash
export HOST=0.0.0.0
export PORT=8787
export ADMIN_TOKEN='替换为长随机令牌'
export RECEIPT_SECRET='替换为至少32字节随机密钥'
export ALLOWED_ORIGINS='https://your-domain.example'
node server.mjs
```

数据默认保存在：

```text
data/feedback.sqlite
```

请定期备份此文件以及 `data/secrets.json`。如果你通过环境变量提供密钥，则重点备份数据库即可。

## Docker

```bash
docker build -t pixelpet-feedback .
docker run -d \
  --name pixelpet-feedback \
  -p 8787:8787 \
  -v pixelpet-data:/app/data \
  -e ADMIN_TOKEN='长随机令牌' \
  -e RECEIPT_SECRET='长随机密钥' \
  -e ALLOWED_ORIGINS='https://your-domain.example' \
  pixelpet-feedback
```

## HTTPS

公开发布时必须在 Node 服务前配置 HTTPS 反向代理，例如 Caddy、Nginx 或云平台自带 TLS。不要直接把 8787 端口暴露为正式 HTTP 网站。

## 单实例限制

当前限流器保存在单个 Node 进程内，SQLite 也按单实例部署设计。早期 Beta 足够使用。如果以后运行多个后端实例，应把数据库迁移到 PostgreSQL，并把限流迁移到 Redis 或其他共享存储。

## 管理员安全

- 不要把 `ADMIN_TOKEN` 写进网页源码或提交到公开 Git 仓库。
- 管理页面令牌只保存在浏览器 `sessionStorage`，关闭标签页后会消失。
- 生产环境应定期更换管理员令牌。
- 管理后台应只通过 HTTPS 访问。
