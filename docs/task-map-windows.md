# Task Map Windows 桌面版

## 产品边界

Windows 桌面版只包含 Task Map 的两个正式功能页：

1. 结构拆解
2. 时间规划

桌面版不包含工具集主页、项目介绍页和直播贴片工作台。AI 拆解与 AI 时间初排仍通过正式 Core 服务完成，模型密钥不会写入安装包或 `.my` 文件。

## `.my` 工程文件

`.my` 是 MUYANG Task Map 的可编辑项目文件，当前格式版本为 `1`。文件内部是 UTF-8 JSON，保存以下内容：

- 唯一总目标与全部子任务
- 任务备注、日期、轨道和依赖关系
- 思维导图节点坐标
- 当前所在功能页、选中节点与时间视图范围
- 项目创建和更新时间

用户可以在规划未完成时随时保存，之后双击 `.my` 文件或从应用内打开并继续编辑。HTML 和 PDF 是最终交付格式，不承担继续编辑的职责。

## 本地验证

```bash
npm ci
npm run build
npm run build:task-map-desktop
npm run desktop:start
```

重点验收：

1. 桌面版首屏直接进入 Task Map，不出现产品介绍。
2. 新建项目后重命名总目标，新增层级并调整时间。
3. 保存为 `.my`，关闭后双击文件重新打开，数据与视图保持一致。
4. 修改后标题显示未保存状态，`Ctrl+S` 保存，`Ctrl+Shift+S` 另存为。
5. `Ctrl+O` 打开工程，`Ctrl+N` 新建工程。
6. PDF 直接保存为文件；HTML 在无网络环境下仍可打开、切换结构图和甘特图。
7. AI 拆解与 AI 时间初排能够通过 Core 返回结果；普通编辑和导出不依赖网络。

## Windows 构建与发布

本地 Windows 环境可运行：

```bash
npm run desktop:pack:win
```

GitHub Actions 工作流 `.github/workflows/task-map-windows.yml` 会在 Windows runner 上生成 NSIS x64 安装包。推送 `task-map-v*` 标签时，会同时创建 GitHub Release，网页中的“Windows 版”入口始终指向最新 Release。

安装器会创建桌面和开始菜单快捷方式，并把 `.my` 注册为 MUYANG Task Map 可编辑工程文件。

## Core 地址

桌面应用默认使用：

```text
https://www.cmuyang23333.top/api
```

内网或验收环境可在启动应用前设置 `TASK_MAP_CORE_API_BASE_URL` 覆盖。桌面主进程只允许访问 `/health` 与 `/v1/task-map/*`，不开放任意网络转发。
