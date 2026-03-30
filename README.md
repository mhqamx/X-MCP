# X-MCP

一个基于 Node.js 的 X/Twitter MCP Server，提供用户资料查询、推文搜索、推文详情获取、单条媒体下载、批量媒体下载等能力。

当前工具集：

- `x_get_user_profile`
- `x_get_tweets`
- `x_search_tweets`
- `x_get_tweet_detail`
- `x_download_media`
- `x_download_all_media`

## 功能说明

- 通过 X Web GraphQL 接口获取用户资料和时间线
- 支持按关键词搜索推文
- 支持下载推文中的图片、视频、GIF
- 支持本地批量下载 `/media` 时间线中的媒体
- 兼容 `stdio` 方式挂载到 MCP Host

## 环境要求

- Node.js 20+
- npm 10+
- 可访问 `x.com`
- 一个可用的 X 登录态 Cookie

建议环境：

- Node.js 22 LTS
- 如本机访问 X 需要代理，配置 `HTTP_PROXY` / `HTTPS_PROXY`

## 目录说明

- `src/`: TypeScript 源码
- `dist/`: 构建产物
- `downloads/`: 下载的媒体文件
- `cookies.txt`: Netscape 格式 Cookie 文件
- `.env.example`: 环境变量示例

注意：

- `downloads/`
- `cookies.txt`
- `cookies.txt.bak-*`
- `.env`

这些文件都已经加入 `.gitignore`，不会上传到远端仓库。

## 安装

```bash
npm install
```

## 准备认证信息

项目支持两种方式提供登录态，优先级如下：

1. 环境变量 `X_COOKIE`
2. 项目根目录下的 `cookies.txt`

### 方式一：使用环境变量

复制示例文件：

```bash
cp .env.example .env
```

把浏览器里的 Cookie 粘进去：

```env
X_COOKIE=auth_token=xxx; ct0=xxx; ...
```

### 方式二：使用 `cookies.txt`

把浏览器导出的 Netscape Cookie 文件保存为项目根目录的 `cookies.txt`。

代码会自动读取：

- `auth_token`
- `ct0`

这两个字段缺一不可。

## 可选环境变量

支持的环境变量如下：

```env
X_COOKIE=auth_token=xxx; ct0=xxx; ...
X_BEARER_TOKEN=
DOWNLOAD_DIR=./downloads
HTTP_TIMEOUT=30000
REQUEST_DELAY=2000
DEBUG=true
HTTP_PROXY=http://127.0.0.1:7897
HTTPS_PROXY=http://127.0.0.1:7897
NODE_USE_ENV_PROXY=1
```

说明：

- `X_COOKIE`: 必填，除非你使用 `cookies.txt`
- `X_BEARER_TOKEN`: 可选，当前默认走 X Web 接口
- `DOWNLOAD_DIR`: 下载目录，默认 `./downloads`
- `HTTP_TIMEOUT`: 请求超时，毫秒
- `REQUEST_DELAY`: 拉取时间线时的请求间隔
- `DEBUG`: 打开调试日志
- `HTTP_PROXY` / `HTTPS_PROXY`: 访问 X 所需代理
- `NODE_USE_ENV_PROXY=1`: 让 Node fetch 使用代理环境变量

## 本地开发

直接以 TypeScript 运行：

```bash
npm run dev
```

等价命令：

```bash
npx tsx src/index.ts
```

启动成功后会在标准错误输出看到：

```text
X Scraper MCP Server 已启动 (stdio 模式)
```

## 本地构建与启动

构建：

```bash
npm run build
```

构建后用 Node 启动：

```bash
npm run start
```

等价命令：

```bash
node dist/index.js
```

注意：

- 这是 `stdio` MCP Server，不会监听 HTTP 端口
- 正常用法是由 MCP Host 拉起该进程

## 在 Claude Desktop 本地安装

### 1. 先构建 MCP

```bash
npm install
npm run build
```

确认构建产物存在：

```bash
ls dist/index.js
```

### 2. 找到 Claude Desktop 配置文件

常见路径：

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`

如果文件不存在，可以手动创建。

### 3. 添加本地 MCP 配置

把下面这段加入 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "x-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/x-mcp/dist/index.js"
      ],
      "env": {
        "X_COOKIE": "auth_token=xxx; ct0=xxx; ...",
        "HTTP_PROXY": "http://127.0.0.1:7897",
        "HTTPS_PROXY": "http://127.0.0.1:7897",
        "NODE_USE_ENV_PROXY": "1"
      }
    }
  }
}
```

说明：

- `command` 建议直接用 `node`
- `args` 指向本项目的 `dist/index.js`
- 如果你不想把 Cookie 放进配置文件，可以删除 `X_COOKIE`，改为在项目根目录放 `cookies.txt`
- 如果本机访问 `x.com` 需要代理，把 `HTTP_PROXY` / `HTTPS_PROXY` / `NODE_USE_ENV_PROXY` 一起带上

### 4. 重启 Claude Desktop

重启后，Claude Desktop 会自动拉起这个本地 MCP Server。

如果接入正常，终端手动运行时会看到：

```text
X Scraper MCP Server 已启动 (stdio 模式)
```

## 在 Codex 本地安装

Codex 这边用的是 `~/.codex/config.toml`。

### 1. 先构建 MCP

```bash
npm install
npm run build
```

### 2. 编辑 Codex 配置

打开：

```bash
~/.codex/config.toml
```

加入下面这段：

```toml
[mcp_servers.x-mcp]
command = "node"
args = ["/absolute/path/to/x-mcp/dist/index.js"]

[mcp_servers.x-mcp.env]
X_COOKIE = "auth_token=xxx; ct0=xxx; ..."
HTTP_PROXY = "http://127.0.0.1:7897"
HTTPS_PROXY = "http://127.0.0.1:7897"
NODE_USE_ENV_PROXY = "1"
```

如果你的 Node 版本支持 `--use-env-proxy`，也可以把 `args` 改成：

```toml
args = ["--use-env-proxy", "/absolute/path/to/x-mcp/dist/index.js"]
```

如果你不想在配置文件里写 Cookie，也可以删掉 `X_COOKIE`，改为在项目根目录提供 `cookies.txt`。

### 3. 可选：用 Codex 命令直接添加

如果本机 `codex` 命令可用，也可以直接执行：

```bash
codex mcp add x-mcp -- node /absolute/path/to/x-mcp/dist/index.js
```

执行完后，再去 `~/.codex/config.toml` 里补环境变量。

### 4. 重启 Codex

重启后新的会话里就能看到 `x-mcp` 工具。

## MCP 挂载排查

如果 Claude 或 Codex 挂载后不可用，优先检查：

- 是否先执行了 `npm run build`
- `dist/index.js` 路径是否写对
- `X_COOKIE` 或 `cookies.txt` 是否有效
- 本机是否需要代理访问 `x.com`
- 是否重启了 Claude Desktop 或 Codex

## 常用命令

安装依赖：

```bash
npm install
```

开发模式启动：

```bash
npm run dev
```

构建：

```bash
npm run build
```

生产启动：

```bash
npm run start
```

下载某账号 `/media` 时间线前 50 个媒体文件：

```bash
npx tsx src/download-user-media.ts example_user 50
```

检查 `/media` 时间线分页结构：

```bash
npx tsx src/inspect-user-media.ts example_user
```

## 工具能力

### `x_get_user_profile`

获取用户资料。

参数：

- `username`: 用户名，不带 `@`

### `x_get_tweets`

获取用户最新推文。

参数：

- `username`
- `count`
- `include_retweets`

### `x_search_tweets`

搜索推文。

参数：

- `query`
- `count`

### `x_get_tweet_detail`

获取单条推文详情。

参数：

- `tweet_url`

### `x_download_media`

下载单条推文中的媒体。

参数：

- `tweet_url`
- `media_type`: `all` / `photo` / `video` / `gif`

### `x_download_all_media`

扫描最近若干条推文并下载其中媒体。

参数：

- `username`
- `count`
- `media_type`

## 常见问题

### 1. 报 `HTTP 404: Query not found`

X Web GraphQL 的 `queryId` 会变化。当前实现已经加入动态发现机制，但如果再次失效，需要重新检查前端 bundle 中的最新操作 ID。

### 2. 启动了但 Host 里看不到工具

检查：

- MCP Host 配置里的 `command` / `args` 是否正确
- `dist/index.js` 是否存在
- 是否先执行了 `npm run build`
- 启动命令是否能在终端单独运行

### 3. 下载失败或超时

检查：

- Cookie 是否有效
- 本机代理是否可访问 `x.com`
- 是否设置了 `HTTP_PROXY` / `HTTPS_PROXY`
- `ct0` 和 `auth_token` 是否都存在

## 本地启动排查

手工启动：

```bash
npm run dev
```

如果需要代理：

```bash
HTTP_PROXY=http://127.0.0.1:7897 \
HTTPS_PROXY=http://127.0.0.1:7897 \
NODE_USE_ENV_PROXY=1 \
npm run dev
```

## Git 远端

推荐远端：

```bash
git remote add origin https://github.com/mhqamx/X-MCP.git
```

如果已存在远端则更新：

```bash
git remote set-url origin https://github.com/mhqamx/X-MCP.git
```
