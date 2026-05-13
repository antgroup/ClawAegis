# ClawAegis Web API for Hermes

Hermes 适配版本的 Web API 服务，提供与 OpenClaw 版本相同的 REST API 接口，但适配 Hermes 的目录结构和配置格式。

## 与 OpenClaw 版本的区别

| 特性 | OpenClaw 版本 | Hermes 版本 |
|------|--------------|-------------|
| 配置文件 | `openclaw.plugin.json` | `config.yaml` |
| 状态目录 | `~/.openclaw/plugins/claw-aegis/` | `~/.hermes/claw-aegis-state/` |
| 配置格式 | JSON | YAML |
| RPC 通信 | 可选（直接读文件） | 必需（实时状态） |

## 安装

```bash
cd /path/to/ClawAegis/web/api-hermes
npm install
npm run build
```

## 启动

```bash
# 默认启动（使用默认 Hermes 路径）
npm start

# 自定义端口
npm start -- --port=3800

# 自定义配置目录
npm start -- --config-dir=/path/to/config --state-dir=/path/to/state

# 不 served 前端（仅 API 模式）
npm start -- --no-frontend
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AEGIS_PORT` | API 服务端口 | `3800` |
| `AEGIS_CONFIG_DIR` | 配置文件目录 | `~/.hermes/plugins/claw-aegis/` |
| `AEGIS_STATE_DIR` | 状态文件目录 | `~/.hermes/claw-aegis-state/` |
| `AEGIS_RPC_SERVER_PATH` | RPC 服务器脚本路径 | `../../rpc-server.js` |
| `AEGIS_STATIC_DIR` | 前端静态文件目录 | `../frontend/dist` |

## API 接口

所有接口前缀为 `/api/v1/`，响应格式统一为 `{ ok: true, data: ... }` 或 `{ ok: false, error: "..." }`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查（包含 RPC 连接状态） |
| GET | `/rpc/status` | RPC 连接状态 |
| GET | `/config` | 获取当前配置 |
| PUT | `/config` | 更新配置 |
| POST | `/config/reset` | 重置为默认配置 |
| GET | `/config/path` | 获取配置文件路径 |
| GET | `/status` | 获取防御状态总览 |
| GET | `/events` | 获取安全事件日志 |
| GET | `/events/summary` | 获取事件统计 |
| GET | `/events/defenses` | 获取防御类型列表 |
| GET | `/skills` | 获取 Trusted Skills 列表 |
| DELETE | `/skills/:path` | 移除指定 Trusted Skill |
| POST | `/skills/scan` | 触发 Skill 扫描 |
| GET | `/skills/state-path` | 获取 trusted-skills.json 路径 |

## 与 Python 适配器集成

此 Web API 服务可以与 `adapters/hermes/` 中的 Python 插件一起工作：

1. Python 插件负责在 Hermes 中拦截工具调用
2. Web API 提供配置管理和可视化界面
3. 两者共享同一个 RPC 运行时（`rpc-server.js`）

启动顺序：
```
1. 启动 Web API (npm start)
   └── 自动启动 RPC server 子进程
2. 启动 Hermes (加载 Python 插件)
   └── Python 插件连接到同一个 RPC server
```

或者：
```
1. 启动 Hermes (Python 插件自动启动 RPC server)
2. 启动 Web API（连接到已运行的 RPC server）
```

## 开发模式

```bash
# 编译并监视变更
npm run dev
```

## 注意事项

1. **配置同步**: Web UI 修改配置后，需要重启 Hermes 插件才能完全生效（部分配置支持热重载）
2. **RPC 连接**: 如果 RPC server 未运行，Web API 会以"config-only 模式"运行，只能读取配置文件
3. **状态文件**: 状态文件（defense-events.jsonl 等）由 RPC runtime 写入，Web API 只读
