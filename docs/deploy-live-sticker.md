# 直播贴片工作台部署

## 公开地址

- Web 工作台：`https://cmuyang23333.top/live-sticker/`
- 未来 Core API：`https://api.cmuyang23333.top`

本仓库只发布静态前端。模型密钥和 Provider Adapter 不进入浏览器，也不写入 EdgeOne 的前端构建变量。

## EdgeOne Pages 配置

在 EdgeOne Pages 创建 `Muyang-Tools-Frontend` 项目时使用：

| 项目项 | 值 |
| --- | --- |
| 分支 | `main` |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build:live-sticker` |
| 输出目录 | `dist` |
| Node.js | 20 或更高版本 |

设置以下构建环境变量：

| 变量 | 预览值 | 正式值 |
| --- | --- | --- |
| `VITE_DEPLOY_BASE` | `/live-sticker/` | `/live-sticker/` |
| `VITE_CORE_API_BASE_URL` | 暂不设置或预览 Core 地址 | `https://api.cmuyang23333.top` |

`VITE_CORE_API_BASE_URL` 是浏览器可见的 API 地址，不得填写 OpenAI、OFOX、DeepSeek 或任何 Provider 的 Key。

## 推荐上线顺序

1. 先部署 EdgeOne Pages，使用其预览域名验证 `live-sticker` 的页面资源和刷新行为。
2. 在 Core 有公网健康接口前，允许页面显示 Core 未连接；此时仅作为前端交互预览，不宣称模型能力已上线。
3. Core 部署完成后，为 `api.cmuyang23333.top` 配置 HTTPS 与 `GET /health`，再把正式 `VITE_CORE_API_BASE_URL` 写入 EdgeOne 并重新构建。
4. 最后把 `cmuyang23333.top` 的 DNS 从当前 GitHub Pages 记录切换到 EdgeOne Pages 所给记录，并在 EdgeOne 中绑定 `cmuyang23333.top`。

## 域名边界

同一个根域名同一时间只能由一个静态站点提供商接管。当前 `cmuyang23333.top` 若仍指向 GitHub Pages，不要同时把同一域名绑定到 EdgeOne。完成 EdgeOne 预览验证后，再在短维护窗口内切换 DNS；GitHub Pages 可保留为仓库级回退，不再占用该自定义域名。

## 本地复核

```bash
npm run build:live-sticker
npm run preview -- --host 127.0.0.1 --port 4185
```

打开 `http://127.0.0.1:4185/live-sticker/`。确认图标、字体预设和其他静态资源均能加载，且 Core 未配置时不会泄露任何密钥。
