# Muyang-Tools-Frontend

正式 Muyang 工具网页前端，部署目标为 `cmuyang23333.top`。

## 第一阶段

- React + Vite 工作台壳
- 直播贴片的背景生成、文字图层、效果融合、导出资产四个独立工作区
- 通过 `CORE_API_BASE_URL` 连接正式 Core；浏览器不保存或使用模型 Provider 密钥

## 本地运行

```bash
npm install
npm run dev
```

复制 `.env.example` 为 `.env.local` 后再配置 Core 地址。
