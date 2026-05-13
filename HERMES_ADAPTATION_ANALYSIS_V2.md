# ClawAegis Hermes 适配分析报告 (完整版)

## 执行摘要

基于对 Hermes Agent 代码库的完整分析，ClawAegis 的 Hermes 适配在技术上可行，但需要注意 Hook 系统的限制和与 Hermes 内置安全功能的重叠。

**关键结论**:
- ✅ 适配架构设计合理 (Python↔Node.js RPC)
- ⚠️ `pre_tool_call` 无法阻断，必须使用 tool wrapper 方式
- ⚠️ 与 Hermes 内置安全功能存在重叠，需要明确分工
- ⚠️ Prompt Guard 效果可能受限（缺少 `before_prompt_build` hook）

---

## 1. Hermes 架构深度分析

### 1.1 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Hermes Agent                           │
├─────────────────────────────────────────────────────────────┤
│  CLI / Gateway (Telegram/Discord/Slack/etc.)                │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────┐   │
│  │  Plugin      │───▶│  Tool        │───▶│  Terminal   │   │
│  │  System      │    │  Registry    │    │  Backends   │   │
│  └──────────────┘    └──────────────┘    │  (docker/   │   │
│         │                   │             │   local/    │   │
│         ▼                   ▼             │   modal)    │   │
│  ┌──────────────┐    ┌──────────────┐     └─────────────┘   │
│  │  Hooks       │    │  Approval    │                       │
│  │  (10 types)  │    │  System      │                       │
│  └──────────────┘    └──────────────┘                       │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────┐   │
│  │  Skills      │    │  Memory      │    │  Cron       │   │
│  │  (auto-      │    │  (multiple   │    │  Scheduler  │   │
│  │   evolving)  │    │  providers)  │    │             │   │
│  └──────────────┘    └──────────────┘    └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Hook 系统详解

Hermes 提供 10 种插件 hooks（`VALID_HOOKS` in `hermes_cli/plugins.py`）:

| Hook | 触发时机 | 返回值是否使用 | 阻断能力 |
|------|---------|---------------|---------|
| `pre_tool_call` | 工具执行前 | ❌ 忽略 | ❌ 不能阻断 |
| `post_tool_call` | 工具执行后 | ❌ 忽略 | N/A |
| `pre_llm_call` | 每轮开始前 | ✅ 可注入 context | ⚠️ 只能注入，不能阻断 |
| `post_llm_call` | 每轮结束后 | ❌ 忽略 | N/A |
| `pre_api_request` | API 请求前 | ❌ 忽略 | ❌ 不能阻断 |
| `post_api_request` | API 请求后 | ❌ 忽略 | N/A |
| `on_session_start` | 会话开始时 | ❌ 忽略 | N/A |
| `on_session_end` | 会话结束时 | ❌ 忽略 | N/A |
| `on_session_finalize` | 会话最终化时 | ❌ 忽略 | N/A |
| `on_session_reset` | 会话重置时 | ❌ 忽略 | N/A |

**关键限制**: 
- `pre_tool_call` 明确设计为 "fire-and-forget observer"，文档说明 "Return value: Ignored"
- 这与 OpenClaw 的 `before_tool_call` 有本质区别（后者可以阻断）

### 1.3 工具注册系统

```python
# tools/registry.py
class ToolRegistry:
    def register(self, name, toolset, schema, handler, ...)
    def deregister(self, name: str)  # 支持注销工具
    def dispatch(self, name: str, args: dict, **kwargs) -> str
```

ClawAegis 的适配器使用 `deregister` + `register` 方式替换工具 handler，这是当前唯一可行的阻断方案。

---

## 2. Hermes 内置安全功能详解

### 2.1 七层安全模型

根据 `website/docs/user-guide/security.md`:

| 层级 | 功能 | 实现位置 |
|------|------|---------|
| 1. User authorization | Gateway 用户授权 | `gateway/` |
| 2. Dangerous command approval | 危险命令审批 | `tools/approval.py` |
| 3. Container isolation | Docker/Singularity/Modal | `tools/environments/` |
| 4. MCP credential filtering | 环境变量隔离 | `tools/mcp_tool.py` |
| 5. Context file scanning | Prompt injection 检测 | `agent/context_engine.py` |
| 6. Cross-session isolation | 会话隔离 | `agent/memory_manager.py` |
| 7. Input sanitization | 工作目录验证 | `tools/terminal_tool.py` |

### 2.2 Dangerous Command Approval 系统

**审批模式** (`approvals.mode`):
- `manual` (默认): 总是提示用户
- `smart`: 使用辅助 LLM 评估风险
- `off`: 禁用所有审批（YOLO 模式）

**触发模式** (部分列表):
- `rm -r`, `rm ... /` (递归删除)
- `chmod 777`, `chown -R root` (权限修改)
- `mkfs`, `dd if=` (格式化/磁盘操作)
- `DROP TABLE`, `DELETE FROM` (SQL 危险操作)
- `curl ... | sh`, `wget ... | sh` (管道到 shell)
- `bash -c`, `python -e` (代码执行)
- `pkill`, `killall hermes` (自终止防护)

**与 ClawAegis 的重叠**:
- ✅ ClawAegis 提供更细粒度的模式匹配
- ✅ ClawAegis 支持编码/混淆检测
- ⚠️ 两者同时启用时，用户可能看到两次确认提示

### 2.3 Container Isolation

**Docker 安全参数**:
```python
_SECURITY_ARGS = [
    "--cap-drop", "ALL",                          # 丢弃所有 Linux capabilities
    "--cap-add", "DAC_OVERRIDE",                  # 允许 root 写入挂载目录
    "--security-opt", "no-new-privileges",        # 阻止权限提升
    "--pids-limit", "256",                        # 进程数限制
    "--tmpfs", "/tmp:rw,nosuid,size=512m",        # 受限制的 /tmp
]
```

**重要**: 容器模式下 Dangerous Command Approval 被跳过，因为容器本身就是安全边界。

### 2.4 其他安全功能

| 功能 | 描述 | 与 ClawAegis 关系 |
|------|------|------------------|
| **SSRF Protection** | 阻止访问私有网络 (RFC 1918)、回环地址、云 metadata | 与 ClawAegis exfiltrationGuard 重叠 |
| **Tirith Scanning** | 预执行内容级扫描 (homograph URL、pipe-to-interpreter) | 与 ClawAegis encodingGuard 互补 |
| **Context File Injection Protection** | 扫描 AGENTS.md/.cursorrules/SOUL.md 的 prompt injection | ClawAegis 无此功能 |
| **Credential Redaction** | MCP 错误消息中的密钥脱敏 | 与 ClawAegis outputRedaction 重叠 |
| **Website Blocklist** | 可配置的域名黑名单 | ClawAegis 无此功能 |

---

## 3. ClawAegis 与 Hermes 安全功能对比

### 3.1 功能重叠矩阵

| 安全功能 | Hermes | ClawAegis | 建议 |
|---------|--------|-----------|------|
| **危险命令拦截** | ✅ Approval 系统 | ✅ commandBlock | 保留 ClawAegis，禁用 Hermes approval (可选) |
| **SSRF/外泄防护** | ✅ 内置 SSRF 保护 | ✅ exfiltrationGuard | 两者互补，都保留 |
| **编码/混淆检测** | ✅ Tirith | ✅ encodingGuard | 两者互补，都保留 |
| **输出脱敏** | ✅ MCP redaction | ✅ outputRedaction | 保留 ClawAegis（更全面） |
| **Prompt Injection 防护** | ✅ Context file scan | ⚠️ promptGuard (受限) | 两者互补 |
| **容器隔离** | ✅ Docker/Modal | ❌ 无 | 使用 Hermes 内置 |
| **用户授权** | ✅ Gateway auth | ❌ 无 | 使用 Hermes 内置 |
| **技能扫描** | ❓ Skills Guard (提及) | ✅ skillScan | 保留 ClawAegis |
| **记忆保护** | ❌ 无 | ✅ memoryGuard | 保留 ClawAegis |
| **循环调用保护** | ❌ 无 | ✅ loopGuard | 保留 ClawAegis |
| **脚本来源追踪** | ❌ 无 | ✅ scriptProvenanceGuard | 保留 ClawAegis |
| **路径保护** | ❌ 无 | ✅ selfProtection | 保留 ClawAegis |

### 3.2 冲突分析

#### 冲突 1: 双重审批提示

**场景**: 用户执行 `rm -rf /tmp/test`

**可能结果**:
1. Hermes approval 系统提示: "Allow recursive delete?"
2. ClawAegis 拦截: "Blocked by commandBlock"

**解决方案**:
```yaml
# ~/.hermes/config.yaml
approvals:
  mode: off  # 禁用 Hermes approval，完全依赖 ClawAegis
```

或者:
```yaml
# ClawAegis config.yaml
commandBlockEnabled: false  # 禁用 ClawAegis，使用 Hermes approval
```

#### 冲突 2: Tool Wrapper 与 Registry 竞争

**场景**: 其他插件也可能使用 tool wrapper 方式

**风险**: 最后一个注册的 wrapper 会生效，可能覆盖 ClawAegis

**解决方案**:
- 确保 ClawAegis 插件名称按字母顺序排在最后（如 `z-claw-aegis`）
- 在 `register()` 中添加检查，确保 wrapper 未被覆盖

#### 冲突 3: Prompt 注入位置

**场景**: ClawAegis 的 Prompt Guard 通过 `pre_llm_call` 注入

**限制**: 
- Hermes: 注入到 user message
- OpenClaw: 注入到 system prompt

**影响**: Prompt Guard 的效果可能减弱，因为:
- System prompt 权重通常更高
- User message 可能被后续对话稀释

**解决方案**:
- 考虑通过其他方式增强 prompt 注入（如修改 Hermes 源码添加 hook）
- 或接受此限制，依赖其他防御层

---

## 4. 运行时冲突详细分析

### 4.1 已确认冲突

| 冲突 | 严重程度 | 说明 | 缓解措施 |
|------|---------|------|---------|
| 双重审批 | 中 | 用户可能看到两次确认 | 配置只启用一个系统 |
| Prompt 注入位置 | 中 | `pre_llm_call` 注入到 user message | 文档说明限制 |
| Tool wrapper 竞争 | 低 | 其他插件可能覆盖 wrapper | 命名排序、覆盖检测 |
| 日志格式 | 低 | Python logging vs Node.js stderr | 统一日志收集 |

### 4.2 潜在冲突（需要测试验证）

| 冲突 | 风险 | 验证方法 |
|------|------|---------|
| Async handler 兼容性 | 中 | 测试 async tool handlers |
| 异常处理 | 低 | 测试 tool 抛出异常时的行为 |
| Session ID 格式 | 低 | 验证 session ID 一致性 |
| 并发安全 | 低 | 测试多线程 tool 调用 |

---

## 5. Hermes 自进化 (Harness) 特性

### 5.1 自动技能创建

Hermes 的 Skills 系统具有自进化特性:
- 复杂任务后自动创建技能
- 技能在使用过程中自我改进
- 符合 [agentskills.io](https://agentskills.io) 开放标准

**与 ClawAegis 的关系**:
- ClawAegis 的 `skillScan` 可以扫描这些自动生成的技能
- 需要确保扫描路径包含 `~/.hermes/skills/`

### 5.2 记忆系统

Hermes 支持多种 memory provider:
- Honcho (用户建模)
- Mem0
- Holographic
- Supermemory
- ByteRover
- RetainDB
- OpenViking

**与 ClawAegis 的关系**:
- ClawAegis 的 `memoryGuard` 保护记忆写入
- 需要适配不同 provider 的写入方式

### 5.3 Cron 调度

Hermes 内置 cron 调度器，支持:
- 自然语言任务调度
- 多平台投递
- 会话隔离的存储路径

**与 ClawAegis 的关系**:
- Cron 任务可能绕过某些安全检查
- 需要确保 `dispatchGuard` 覆盖 cron 执行路径

---

## 6. 改进建议

### 6.1 高优先级

1. **添加配置选项禁用 Hermes approval**
   ```python
   # 在 __init__.py 的 register() 中添加提示
   logger.info("ClawAegis: Consider setting 'approvals.mode: off' in Hermes config to avoid double prompts")
   ```

2. **验证 tool wrapper 未被覆盖**
   ```python
   # tool_wrappers.py
   def wrap_dangerous_tools(engine, ...):
       for tool_name in TOOLS_TO_WRAP:
           entry = registry._tools.get(tool_name)
           # 检查 handler 是否已被替换
           if entry.handler.__name__ != 'sync_handler':
               logger.warning(f"Tool {tool_name} may have been wrapped by another plugin")
   ```

3. **改进 Prompt Guard 注入**
   ```python
   # 考虑使用更突出的格式
   context_parts.append(f"[SECURITY POLICY]\n{guard_result['context']}\n[/SECURITY POLICY]")
   ```

### 6.2 中优先级

1. **适配 Hermes 多记忆 provider**
   - 当前只保护 `memory_store`, `MEMORY.md`, `SOUL.md`
   - 需要了解各 provider 的存储位置

2. **添加 Hermes 版本检测**
   ```python
   # 检查 Hermes 版本是否 >= 0.9.0
   import hermes_cli
   version = getattr(hermes_cli, '__version__', '0.0.0')
   ```

3. **WebUI 适配**
   - 创建 Hermes 版本的配置 API
   - 或者使用独立的 WebUI 进程

### 6.3 低优先级

1. **性能优化**: RPC 调用批量处理
2. **增强日志**: 统一使用 Hermes 日志格式
3. **测试覆盖**: 添加 Hermes 集成测试

---

## 7. 安装指南

### 7.1 前置要求

- Node.js >= 20
- Hermes Agent >= 0.9.0
- Python >= 3.9

### 7.2 安装步骤

```bash
# 1. 进入 ClawAegis 目录
cd /path/to/ClawAegis

# 2. 确保在 hermes-adaptation 分支
git checkout hermes-adaptation

# 3. 运行安装脚本
bash adapters/hermes/install.sh
```

### 7.3 配置建议

**Hermes 配置** (`~/.hermes/config.yaml`):
```yaml
# 禁用 Hermes approval，使用 ClawAegis
approvals:
  mode: off

# 或者保持 smart 模式，但禁用与 ClawAegis 重叠的部分
# approvals:
#   mode: smart
```

**ClawAegis 配置** (`~/.hermes/plugins/claw-aegis/config.yaml`):
```yaml
allDefensesEnabled: true
defaultBlockingMode: enforce

# 根据需求调整
selfProtectionEnabled: true
commandBlockEnabled: true      # 如果 Hermes approval 开启，可禁用此项
encodingGuardEnabled: true
exfiltrationGuardEnabled: true
memoryGuardEnabled: true
skillScanEnabled: true

# Hermes 特有路径
protectedPaths:
  - ~/.hermes/.env
  - ~/.hermes/config.yaml
  - ~/.hermes/skills/important-skill
```

### 7.4 验证安装

```bash
# 查看日志验证插件是否加载
tail -f ~/.hermes/claw-aegis-state/defense-events.jsonl

# 测试危险命令拦截
# 在 Hermes 中执行: rm -rf /tmp/test
# 应该看到 ClawAegis 拦截提示
```

---

## 8. 结论

### 8.1 适配状态

**可用性**: ⚠️ **Beta 级别**

| 功能 | 完成度 | 说明 |
|------|--------|------|
| Tool 拦截 | 90% | Wrapper 方式可行，但不如原生 hook 可靠 |
| Prompt Guard | 70% | 注入位置受限，效果可能减弱 |
| 其他防御 | 95% | 基本功能正常 |
| 配置管理 | 80% | YAML 配置，无 WebUI |
| 文档 | 85% | 需要更多示例 |

### 8.2 与 Hermes 内置安全的协作建议

```
┌─────────────────────────────────────────────────────────────┐
│                    推荐安全架构                              │
├─────────────────────────────────────────────────────────────┤
│  Hermes 负责:                                                │
│    ✅ Gateway 用户授权                                      │
│    ✅ Container 隔离 (Docker/Modal)                          │
│    ✅ SSRF 防护 (内置)                                       │
│    ✅ Context file injection 防护                           │
│                                                              │
│  ClawAegis 负责:                                             │
│    ✅ Tool 调用拦截 (commandBlock, selfProtection)         │
│    ✅ 编码/混淆检测 (encodingGuard)                         │
│    ✅ 外泄链检测 (exfiltrationGuard)                        │
│    ✅ 记忆保护 (memoryGuard)                                │
│    ✅ 技能扫描 (skillScan)                                  │
│    ✅ 循环调用保护 (loopGuard)                              │
│    ✅ 输出脱敏 (outputRedaction)                          │
│                                                              │
│  两者协作:                                                   │
│    ⚠️ Prompt 防护 (Hermes context scan + ClawAegis guard)  │
│    ⚠️ 危险命令 (Hermes approval OFF, ClawAegis ON)         │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 下一步行动

1. **立即**: 在实际 Hermes 环境测试适配器
2. **短期**: 解决发现的冲突，完善配置文档
3. **中期**: 添加集成测试，验证各防御功能
4. **长期**: 考虑向 Hermes 提交 PR 添加 `before_tool_call` hook

---

## 附录 A: Hermes Hook 与 OpenClaw Hook 对比

| OpenClaw Hook | Hermes 等价物 | 阻断能力 | 备注 |
|--------------|--------------|---------|------|
| `on_session_start` | `on_session_start` | N/A | 相同 |
| `on_session_end` | `on_session_end` | N/A | 相同 |
| `before_prompt_build` | ❌ 无 | - | 关键差异 |
| `before_message_write` | ❌ 无 | - | 关键差异 |
| `before_tool_call` | `pre_tool_call` | ❌ 不能阻断 | 关键差异 |
| `after_tool_call` | `post_tool_call` | N/A | 相同 |
| `message_received` | `pre_llm_call` | ⚠️ 只能注入 | 功能受限 |
| `before_agent_run` | `pre_llm_call` | ⚠️ 只能注入 | 功能受限 |
| `agent_run_complete` | `post_llm_call` | N/A | 相同 |

---

## 附录 B: 已知问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| Tool 调用无法阻断 | `pre_tool_call` 设计为 observer | 使用 tool wrapper 方式 |
| Prompt 注入效果弱 | 注入到 user message 而非 system prompt | 增强注入格式，接受限制 |
| 双重审批提示 | Hermes + ClawAegis 都启用 | 禁用 Hermes approval |
| WebUI 不可用 | 依赖 OpenClaw API | 使用 YAML 配置或开发 Hermes 版本 |

---

*报告生成时间: 2026-04-28*
*分析基于: Hermes Agent (commit 未知), ClawAegis (hermes-adaptation 分支)*
