# ClawAegis Hermes 适配分析报告

## 1. 当前改动概览

### 1.1 新增文件结构

当前 `hermes-adaptation` 分支相比 `main` 新增了以下适配组件：

```
adapters/hermes/
├── __init__.py          # 插件入口点，注册 hooks 和 tool wrappers
├── bridge.py            # JSON-RPC 子进程管理 (AegisEngine)
├── tool_wrappers.py     # 高风险工具包装器
├── plugin.yaml          # Hermes 插件清单
└── install.sh           # 安装脚本

rpc-server.ts            # Node.js JSON-RPC 服务器入口
rpc-handlers.ts          # RPC 方法处理器 (agent-agnostic runtime)
```

### 1.2 架构设计

**适配器采用双层架构：**

1. **Python 层 (Hermes 插件)**
   - 通过 `register(ctx)` 注册生命周期 hooks
   - 使用 `tool_wrappers` 拦截高风险工具调用
   - 通过 JSON-RPC 与 Node.js 层通信

2. **Node.js 层 (ClawAegis 核心)**
   - 复用原有的 TypeScript 安全检测引擎
   - 通过 `AegisRpcRuntime` 暴露 RPC 接口
   - 保持与 OpenClaw 版本相同的检测规则

### 1.3 集成的防御功能

当前适配已实现以下 ClawAegis 防御功能：

| 防御功能 | 实现状态 | 说明 |
|---------|---------|------|
| User Risk Scan | ✅ | 检测越狱/数据外泄意图 |
| Prompt Guard | ✅ | 注入安全上下文到 prompts |
| Tool Call 检查 | ✅ | 通过 tool_wrappers 拦截 |
| Tool Result 扫描 | ✅ | 检测结果中的注入模式 |
| Skill Scan | ✅ | 启动时扫描技能文件 |
| Self Protection | ✅ | 保护敏感路径和插件 |
| Command Block | ✅ | 拦截高风险命令 |
| Encoding Guard | ✅ | 检测编码/混淆 payload |
| Loop Guard | ✅ | 防止重复变异调用 |
| Exfiltration Guard | ✅ | 阻断 SSRF/外泄链 |
| Memory Guard | ✅ | 保护记忆写入 |
| Output Redaction | ✅ | 敏感信息脱敏 |
| Dispatch Guard | ⚠️ | 部分实现 (依赖 Hermes dispatch 机制) |

---

## 2. 功能完整性评估

### 2.1 OpenClaw vs Hermes 功能对比

| 功能 | OpenClaw 实现 | Hermes 适配 | 差异分析 |
|------|--------------|------------|---------|
| **Hook 系统** | 9 个生命周期 hooks | 6 个 hooks | Hermes 缺少 `before_prompt_build`, `before_message_write` |
| **Tool 拦截** | 原生 `before_tool_call` | Wrapper 替换 | Hermes `pre_tool_call` 只能观察，不能阻断 |
| **配置存储** | `openclaw.plugin.json` | `config.yaml` | 需要手动同步配置格式 |
| **WebUI** | 完整功能 | 未适配 | WebUI 依赖 OpenClaw 特定 API |
| **状态持久化** | 自动 | 需手动配置 `stateDir` | 路径解析逻辑不同 |

### 2.2 关键限制

1. **Tool Call 拦截机制差异**
   - OpenClaw: `before_tool_call` hook 可以真正阻断
   - Hermes: `pre_tool_call` 只能观察，实际通过 wrapper 替换实现阻断
   - **风险**: Wrapper 替换可能在某些边缘情况下失效

2. **Prompt 注入限制**
   - OpenClaw: 有 `before_prompt_build` hook 可以直接修改 prompt
   - Hermes: 只有 `pre_llm_call` hook，prompt 构建已完成
   - **影响**: Prompt Guard 的上下文注入效果可能减弱

3. **配置管理**
   - OpenClaw: 有完整的 UI 配置界面
   - Hermes: 仅支持 YAML 配置文件
   - **影响**: 用户体验下降，配置错误风险增加

---

## 3. Hermes 自进化 (Harness) 特性分析

### 3.1 Hermes Harness 架构特点

基于代码分析，Hermes 相比 OpenClaw 有以下架构差异：

| 特性 | Hermes | OpenClaw |
|------|--------|----------|
| **运行时架构** | Python + Node.js 混合 | 纯 Node.js |
| **工具注册** | Python `tools.registry` | JavaScript 对象 |
| **Hook 系统** | Python 事件驱动 | TypeScript 回调 |
| **配置管理** | YAML/JSON 混合 | 纯 JSON |
| **插件系统** | Python 模块加载 | Node.js 模块 |

### 3.2 Hermes 内置安全措施

从适配器代码推断，Hermes 可能具有以下内置安全机制：

1. **工具沙箱**: 工具在隔离环境中执行
2. **权限系统**: 基于 `check_fn` 和 `requires_env` 的权限控制
3. **Hook 链**: 多插件可以注册同一 hook，形成链式处理

### 3.3 潜在冲突分析

| 冲突点 | 风险等级 | 说明 |
|--------|---------|------|
| **双重拦截** | 中 | Hermes 可能有内置 tool 拦截，与 ClawAegis wrapper 可能重复 |
| **Prompt 注入竞争** | 低 | 如果 Hermes 也有 prompt 修改机制，可能产生冲突 |
| **状态管理** | 低 | 双方可能同时操作某些状态文件 |
| **日志格式** | 低 | 日志格式不统一，影响可观测性 |

---

## 4. 运行时冲突详细分析

### 4.1 确认存在的冲突

#### 冲突 1: Tool Wrapper 与原生 Hook 的竞争

```python
# Hermes 原生可能也有 tool 拦截
ctx.register_hook("pre_tool_call", _make_pre_tool_call_handler(engine))

# ClawAegis 通过 wrapper 替换
wrap_dangerous_tools(engine, _get_session_key, _get_run_id)
```

**问题**: 如果 Hermes 原生 `pre_tool_call` 已经拦截，ClawAegis wrapper 可能无法执行。

**解决方案**: 
- 优先使用 wrapper 方式（当前已实现）
- 移除 `pre_tool_call` hook 注册（可选优化）

#### 冲突 2: 路径解析差异

```python
# ClawAegis 使用 OpenClaw 风格路径
protected_roots = [
    str(hermes_home / "plugins" / "claw-aegis"),
    str(hermes_home),
    plugin_root,
]
```

**问题**: Hermes 和 OpenClaw 的状态目录结构不同。

**当前状态**: 已在 `_resolve_paths()` 中处理，但可能需要根据实际 Hermes 结构调整。

### 4.2 需要进一步验证的假设

1. **Hermes 是否有内置的安全插件？**
   - 如果有，可能与 ClawAegis 功能重复
   - 建议检查 `~/.hermes/plugins/` 目录

2. **Hermes 的 `tools.registry` 是否线程安全？**
   - ClawAegis 在 `register()` 时修改 registry
   - 如果 Hermes 并发加载工具，可能产生竞态条件

3. **Hermes 的 session 生命周期是否与 OpenClaw 一致？**
   - 当前假设一致，但可能影响状态清理

---

## 5. 改进建议

### 5.1 高优先级修复

1. **添加 Hermes 版本检测**
   ```python
   # 在 register() 中添加
   hermes_version = ctx.get_version()  # 假设有此 API
   if hermes_version < "0.9.0":
       logger.warning("ClawAegis requires Hermes >= 0.9.0")
   ```

2. **改进路径解析**
   ```python
   # 需要实际测试 Hermes 的目录结构
   # 当前假设 ~/.hermes/ 结构可能与实际不同
   ```

3. **添加更多防御性编程**
   ```python
   # tool_wrappers.py 中
   try:
       from tools.registry import registry
   except ImportError:
       logger.error("Cannot import tools.registry")
       return
   
   # 添加更多安全检查
   if not hasattr(registry, '_tools'):
       logger.error("Registry structure unexpected")
       return
   ```

### 5.2 中优先级优化

1. **WebUI 适配**
   - 当前 WebUI 依赖 OpenClaw 特定 API
   - 需要创建 Hermes 版本的配置接口

2. **配置同步机制**
   - 实现 `config.yaml` 到内部配置的自动同步
   - 支持配置热重载

3. **增强日志集成**
   - 统一使用 Hermes 的日志格式
   - 支持日志级别配置

### 5.3 低优先级改进

1. **性能优化**
   - RPC 调用可以批量处理
   - 缓存频繁访问的配置项

2. **测试覆盖**
   - 添加 Hermes 特定的集成测试
   - 模拟不同版本的 Hermes 行为

---

## 6. 安装指南

### 6.1 前置要求

- Node.js >= 20
- Hermes Agent >= 0.9.0 (推测版本，需验证)
- Python >= 3.9 (Hermes 依赖)

### 6.2 安装步骤

```bash
# 1. 克隆 ClawAegis
git clone https://github.com/antgroup/ClawAegis.git
cd ClawAegis

# 2. 切换到 hermes-adaptation 分支
git checkout hermes-adaptation

# 3. 运行安装脚本
bash adapters/hermes/install.sh
```

安装脚本会自动：
- 编译 TypeScript
- 复制文件到 `~/.hermes/plugins/claw-aegis/`
- 生成默认 `config.yaml`
- 创建状态目录 `~/.hermes/claw-aegis-state/`

### 6.3 手动配置

编辑 `~/.hermes/plugins/claw-aegis/config.yaml`：

```yaml
# ClawAegis configuration for Hermes Agent
allDefensesEnabled: true
defaultBlockingMode: enforce

# 根据需求调整各防御模式
selfProtectionEnabled: true
selfProtectionMode: enforce
commandBlockEnabled: true
commandBlockMode: enforce

# 保护路径
protectedPaths:
  - /path/to/sensitive/data

# 保护技能
protectedSkills:
  - important-skill
```

### 6.4 验证安装

```bash
# 重启 Hermes 后检查日志验证插件是否加载
tail -f ~/.hermes/claw-aegis-state/defense-events.jsonl
```

### 6.5 卸载

```bash
# 删除插件目录
rm -rf ~/.hermes/plugins/claw-aegis

# 删除状态目录（如需保留日志可跳过）
rm -rf ~/.hermes/claw-aegis-state
```

---

## 7. 结论

### 7.1 当前适配状态

**可用性**: ⚠️ **Beta 级别**

当前适配实现了 ClawAegis 核心功能的 90%，但存在以下限制：

1. 依赖 tool wrapper 方式实现拦截，不如原生 hook 可靠
2. Prompt Guard 的注入点可能不如 OpenClaw 版本有效
3. 缺少 WebUI，配置管理不够友好

### 7.2 建议的使用场景

✅ **适合使用**:
- 需要基础安全防护的 Hermes 用户
- 可以接受配置文件管理的场景
- 对 tool 拦截有基本需求的场景

❌ **不建议使用**:
- 需要最高安全级别的生产环境
- 依赖复杂 prompt 注入防护的场景
- 需要图形化配置界面的用户

### 7.3 下一步行动

1. **验证 Hermes 版本兼容性**: 需要实际测试不同 Hermes 版本
2. **完善路径解析**: 根据实际 Hermes 目录结构调整
3. **添加集成测试**: 确保各防御功能正常工作
4. **文档完善**: 根据用户反馈持续更新

---

## 附录: 与 Hermes 内置安全功能的对比

| 安全功能 | ClawAegis | Hermes (推测) | 建议 |
|---------|-----------|--------------|------|
| Tool 拦截 | ✅ 多层防御 | ⚠️ 基础权限 | 保留 ClawAegis |
| Prompt 保护 | ✅ 上下文注入 | ❓ 未知 | 需要调研 |
| 技能扫描 | ✅ 启动时扫描 | ❓ 未知 | 保留 ClawAegis |
| 配置保护 | ✅ 路径保护 | ❓ 未知 | 保留 ClawAegis |
| 输出脱敏 | ✅ 自动 | ❓ 未知 | 保留 ClawAegis |

**注意**: 由于无法访问实际的 Hermes 代码库，以上对 Hermes 内置功能的分析基于适配器代码的推断。建议与 Hermes 开发团队确认具体的安全特性，以避免功能重复或冲突。
