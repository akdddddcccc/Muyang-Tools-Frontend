# 直播贴片工作台部署

## 公开地址

- Web 工作台：`https://cmuyang23333.top/live-sticker/`
- 未来 Core API：`https://api.cmuyang23333.top`

`cmuyang23333.top` 没有备案，正式前端部署到 Vercel，不使用 EdgeOne 中国大陆节点。本仓库仅发布静态前端；模型密钥、Provider Adapter 和服务端密钥绝不进入 Vercel 的 `VITE_` 环境变量。

## Vercel 项目配置

在 Vercel 导入 GitHub 仓库 `akdddddcccc/Muyang-Tools-Frontend`，使用：

| 项目项 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build:live-sticker` |
| 输出目录 | `dist` |
| Node.js | 20 或更高版本 |

构建后的静态结构为：

```text
dist/
  live-sticker/
    index.html
    assets/
```

因此 Vercel 会在 `/live-sticker/` 提供工作台，根地址会临时跳转到该入口。以后正式工具首页出现时，再将根地址改为工具导航页。

## 环境变量

| 变量 | 预览阶段 | Core 上线后 |
| --- | --- | --- |
| `VITE_CORE_API_BASE_URL` | 不设置 | `https://api.cmuyang23333.top` |

未设置时页面仅显示 Core 未连接，仍可用于前端交互和本地项目数据验收。`VITE_CORE_API_BASE_URL` 是浏览器可见地址，不得填入 OpenAI、OFOX、DeepSeek 或任何 Provider 的 Key。

## 上线顺序

1. 在 Vercel 导入仓库并完成首次部署，先打开 Vercel 分配的 `*.vercel.app/live-sticker/` 预览地址。
2. 验收图标、字体预设、上传素材、融合画板与刷新后的本地项目恢复。
3. 在 Vercel 项目 Settings > Domains 添加 `cmuyang23333.top`，以 Vercel 后台显示的 CNAME 目标为准。
4. 在域名 DNS 服务商处移除当前指向 GitHub Pages 的 `cmuyang23333.top` A 记录，再添加 Vercel 要求的 CNAME；不要同时保留 A 与 CNAME。
5. 等 HTTPS 证书签发并验证 `https://cmuyang23333.top/live-sticker/` 后，再进入 Core 公网部署阶段。

## Core 边界

Core 不随本次静态前端部署。后续可部署到单位服务器或海外服务，并让 `api.cmuyang23333.top` 指向该服务；必须启用 HTTPS、限制 CORS 来源、提供 `GET /health`，然后才在 Vercel 写入 `VITE_CORE_API_BASE_URL` 并重新部署。

## 本地复核

```bash
npm run build:live-sticker
(cd dist && python3 -m http.server 4185)
```

打开 `http://127.0.0.1:4185/live-sticker/`。确认资源均从 `/live-sticker/assets/` 加载，且未配置 Core 时不会泄露任何密钥。
