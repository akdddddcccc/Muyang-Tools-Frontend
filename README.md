# Muyang-Tools-Frontend

正式 Muyang 工具网页前端，首个公开入口为 `cmuyang23333.top/live-sticker/`。

## 第一阶段

- React + Vite 工作台壳
- 直播贴片的背景生成、文字图层、效果融合、导出资产四个独立工作区
- 通过 `VITE_CORE_API_BASE_URL` 连接正式 Core；浏览器不保存或使用模型 Provider 密钥

## 本地运行

```bash
npm install
npm run dev
```

复制 `.env.example` 为 `.env.local` 后再配置 Core 地址。

## 部署

线上子页面的构建与切换步骤见 [docs/deploy-live-sticker.md](docs/deploy-live-sticker.md)。

## Task Map Windows 版

Windows 桌面版只保留“结构拆解”和“时间规划”两个工作区，支持打开、保存和双击关联 `.my` 可编辑工程文件，并可导出 PDF 清单与交互 HTML。

```bash
npm run desktop:start
npm run desktop:pack:win
```

完整的工程格式、构建和发布流程见 [docs/task-map-windows.md](docs/task-map-windows.md)。
