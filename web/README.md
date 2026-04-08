# Claw Aegis WebUI

Claw Aegis 安全插件的独立 Web 管理面板，用于可视化配置防御策略、查看安全状态、浏览事件日志和管理 Skill 扫描。

## 快速开始

```bash
cd web
npm install
npm run build
npm start
```

启动后访问 `http://localhost:3800` 即可打开管理面板。

## 开发模式

```bash
npm run dev
```

开发模式下 API 服务运行在 `:3800`，Vite 前端开发服务器运行在 `:3801`（自动代理 API 请求）。

## 项目结构

```
web/
├── shared/          # 前后端共享的类型定义、Zod 校验 schema、防御分组元数据
├── api/             # Express 后端服务
│   └── src/
│       ├── routes/          # API 路由（config、status、events、skills）
│       └── services/        # 业务逻辑（配置读写、状态读取、事件管理、文件监听）
└── frontend/        # React + Vite + TailwindCSS 前端
    └── src/
        ├── api/             # API 客户端封装 + React Query hooks
        ├── pages/           # 页面组件（Dashboard、Config、Events、Skills）
        └── components/      # UI 组件（布局、仪表盘、配置编辑器、通用控件）
```

## 功能页面

### Dashboard（仪表盘）

- 防御状态统计卡片（Enforce / Observe / Off 数量）
- 12 项防御机制状态矩阵
- 插件自完整性状态
- Trusted Skills 计数
- 最近安全事件列表

### Config（配置编辑器）

- **Master Controls**：全局防御开关 + 默认拦截模式（off / observe / enforce）
- **Execution Guards**：7 个执行层防御卡片，每个可独立开关并选择模式
- **Scanning & Output**：5 个扫描和输出相关防御开关
- **Protected Assets**：标签式编辑器，管理受保护的路径、Skill ID、Plugin ID
- **Advanced**：可折叠的高级选项（启动时 Skill 扫描等）
- 脏状态追踪，Save / Reset to Defaults 按钮

### Events（安全事件日志）

- 支持按防御类型和结果（blocked / observed / clear）筛选
- 表格展示时间、防御名称、结果、工具名、拦截原因
- 自动每 10 秒刷新

### Skills（Skill 扫描管理）

- Trusted Skills 列表（路径、哈希、大小、扫描时间）
- 手动移除 Trusted Skill（移除后下次扫描会重新评估）

## API 接口

所有接口前缀为 `/api/v1/`，响应格式统一为 `{ ok: true, data: ... }` 或 `{ ok: false, error: "..." }`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/config` | 获取当前配置（合并默认值后） |
| PUT | `/config` | 更新配置（Zod 校验后写入文件） |
| POST | `/config/reset` | 重置为默认配置 |
| GET | `/status` | 获取防御状态总览 |
| GET | `/events` | 获取安全事件日志，支持 `?limit=&offset=&defense=&result=` |
| GET | `/skills` | 获取 Trusted Skills 列表 |
| DELETE | `/skills/:path` | 移除指定 Trusted Skill |
| GET | `/health` | 健康检查 |

## 配置

通过环境变量或命令行参数配置：

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `AEGIS_PORT` | API 服务端口 | `3800` |
| `AEGIS_CONFIG_DIR` | `openclaw.plugin.json` 所在目录 | 当前工作目录 |
| `AEGIS_STATE_DIR` | 插件状态目录（trusted-skills.json 等） | 空（不读取状态文件） |

命令行参数形式：

```bash
npm start -- --port=3800 --config-dir=/path/to/plugin --state-dir=~/.openclaw/plugins/claw-aegis
```

## 配置读写机制

WebUI 独立于 OpenClaw 运行，通过直接读写 `openclaw.plugin.json` 管理配置：

- 读取时从 `configSchema.properties` 提取默认值，从 `userConfig` 字段读取用户覆盖配置，合并后返回
- 写入时将用户修改合并到 `userConfig` 字段，使用原子写入（临时文件 + rename）确保安全
- 配置解析逻辑与插件运行时的 `resolveClawAegisPluginConfig` 对齐，保证 WebUI 展示的状态与实际运行一致

## 状态文件

当配置了 `AEGIS_STATE_DIR` 后，WebUI 会读取以下文件：

- `trusted-skills.json` — Skill 扫描器标记为可信的 Skill 记录
- `self-integrity.json` — 插件自完整性校验记录（文件指纹、受保护根目录）

后端通过 chokidar 监听这些文件的变更，自动记录为安全事件。

## 技术栈

- **前端**：React 18 + Vite + TailwindCSS + React Query + Recharts + Lucide Icons
- **后端**：Express + chokidar
- **共享**：Zod 校验 + TypeScript 类型
- **构建**：npm workspaces monorepo

## 生产部署

```bash
npm run build
npm start
```

生产模式下 Express 同时托管 API 和前端静态文件，只需暴露一个端口。
