> v5.5.1：已修复 Windows 下主页与管理后台显示 `Invalid path` 的问题。

# PixelPet Studio v5.5 Feedback

这是 PixelPet 的免费反馈版：用户完成宠物后，必须先提交 1–5 星评分、国籍和文字评价，服务器确认保存成功后才会解锁 PNG、精灵图和 `.petpack` 下载。

## 核心特性

- 宠物图片仍在浏览器本地处理，不会发送到反馈服务器。
- 评价保存在本地 SQLite 数据库 `data/feedback.sqlite`。
- 无第三方 npm 依赖，使用 Node.js 内置 HTTP、Crypto 和 SQLite。
- 评价成功后返回 HMAC 签名回执，浏览器保存回执并在 180 天内验证下载权限。
- 管理后台支持统计、搜索、筛选和 CSV 导出。
- 支持中文、英语、西班牙语、法语、俄语和阿拉伯语评价界面。
- 包含限流、蜜罐字段、长度限制、匿名标识哈希和严格安全响应头。

## 本地启动

推荐 Node.js 24 LTS。Node.js 22.13 及以上也可以运行。

### Windows

双击：

```text
启动网站和评价系统.bat
```

或者在目录中运行：

```bash
node server.mjs
```

然后打开：

```text
http://localhost:8787
```

管理后台：

```text
http://localhost:8787/admin
```

服务器启动时会在终端显示管理员令牌。开发环境自动生成的令牌也保存在：

```text
data/secrets.json
```

## 生产环境变量

复制 `.env.example` 中的值到部署平台环境变量。服务器本身不自动加载 `.env` 文件；可以通过系统服务、Docker 或部署平台注入。

必须设置：

```text
ADMIN_TOKEN
RECEIPT_SECRET
```

建议使用至少 32 字节的随机字符串。

## 数据库字段

服务器保存：

- 星级：1–5
- 国籍：用户主动填写
- 文字评价
- 界面语言
- 宠物名称
- 提交时间
- 匿名客户端哈希
- 匿名网络哈希
- 同意状态

服务器不保存宠物照片、骨骼数据、`.petpack` 或原始 IP 地址。

## API

```text
POST /api/feedback
POST /api/feedback/verify
GET  /api/health
GET  /api/admin/feedback
GET  /api/admin/export.csv
```

管理 API 需要：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

## 注意

前端下载文件是在浏览器本地生成的，因此评价门槛主要用于正常用户流程和反馈收集，并不是数字版权保护系统。熟悉前端代码的用户仍可能绕过界面限制。
