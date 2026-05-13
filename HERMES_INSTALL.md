# ClawAegis for Hermes 安装指南

> **注意**: Hermes 没有内置的 `plugin install` 命令。插件通过放入 `~/.hermes/plugins/` 目录自动加载。

## 快速安装

```bash
# 1. 进入 ClawAegis 目录
cd /path/to/ClawAegis

# 2. 确保在 hermes-adaptation 分支
git checkout hermes-adaptation

# 3. 运行安装脚本
bash adapters/hermes/install.sh
```

安装完成后，重启 Hermes 即可生效。

## Web UI

ClawAegis for Hermes 包含一个 Web 管理界面，用于可视化配置和监控安全状态。

### 启动 Web UI

**方式一：随 Hermes 自动启动**

编辑 `~/.hermes/plugins/claw-aegis/config.yaml`，添加：
```yaml
webPort: 3800
```

重启 Hermes 后，Web UI 将自动在 http://localhost:3800 启动。

**方式二：独立启动（无需 Hermes）**

```bash
./start-web-hermes.sh [port]
```

这将以独立模式启动 Web API，适用于开发和调试。

### Web UI 功能

- **Dashboard**: 防御状态总览、统计卡片
- **Config**: 可视化配置编辑器
- **Events**: 安全事件日志浏览
- **Skills**: 可信技能管理

## 手动安装

如果自动安装失败，可以手动安装：

```bash
# 1. 编译 TypeScript
npm install
npx tsc --project tsconfig.json

# 2. 创建插件目录
mkdir -p ~/.hermes/plugins

# 3. 复制适配器文件（推荐复制而非软链接，避免路径问题）
cp -r /path/to/ClawAegis/adapters/hermes ~/.hermes/plugins/claw-aegis

# 4. 创建状态目录
mkdir -p ~/.hermes/claw-aegis-state

# 5. 创建默认配置
cat > ~/.hermes/plugins/claw-aegis/config.yaml << 'EOF'
allDefensesEnabled: true
defaultBlockingMode: enforce
EOF
```

## 配置说明

编辑 `~/.hermes/plugins/claw-aegis/config.yaml`：

```yaml
# 主开关
allDefensesEnabled: true              # 启用所有防御
defaultBlockingMode: enforce          # 默认模式: enforce(阻断) / observe(观察) / off(关闭)

# 各防御开关
selfProtectionEnabled: true             # 保护敏感路径
commandBlockEnabled: true               # 拦截高风险命令
encodingGuardEnabled: true              # 检测编码 payload
scriptProvenanceGuardEnabled: true      # 脚本来源追踪
memoryGuardEnabled: true                # 保护记忆写入
userRiskScanEnabled: true               # 扫描用户意图
skillScanEnabled: true                  # 扫描技能文件
toolResultScanEnabled: true             # 扫描工具结果
outputRedactionEnabled: true            # 输出脱敏
promptGuardEnabled: true                # Prompt 保护
loopGuardEnabled: true                  # 循环调用保护
exfiltrationGuardEnabled: true          # 外泄链检测
toolCallEnforcementEnabled: true        # 强制工具调用
dispatchGuardEnabled: true              # 消息分发保护

# 保护路径
protectedPaths: []
#  - /path/to/sensitive/file

# 保护技能
protectedSkills: []
#  - my-important-skill

# 保护插件
protectedPlugins: []
#  - audit-guard
```

## 验证安装

Hermes 没有提供插件管理 CLI 命令。验证安装成功的方法：

```bash
# 1. 检查插件目录是否存在
ls -la ~/.hermes/plugins/claw-aegis/

# 2. 查看配置文件
cat ~/.hermes/plugins/claw-aegis/config.yaml

# 3. 重启 Hermes 后查看日志（如有拦截事件发生）
tail -f ~/.hermes/claw-aegis-state/defense-events.jsonl
```

## 故障排查

### 问题: "Cannot find rpc-server.js"

**解决**: 确保已编译 TypeScript
```bash
cd /path/to/ClawAegis
npx tsc --project tsconfig.json
```

### 问题: "Cannot import tools.registry"

**解决**: 确保 Hermes 版本 >= 0.9.0，且工具注册表已初始化

### 问题: 配置未生效

**解决**:
1. 检查配置文件路径: `~/.hermes/plugins/claw-aegis/config.yaml`
2. 重启 Hermes
3. 检查日志: `~/.hermes/claw-aegis-state/defense-events.jsonl`

## 卸载

```bash
# 删除插件目录
rm -rf ~/.hermes/plugins/claw-aegis

# 删除状态目录（如需保留日志可跳过此步骤）
rm -rf ~/.hermes/claw-aegis-state

# 重启 Hermes
```

## 注意事项

1. **首次安装建议**: 使用 `observe` 模式观察一周，确认无误后再切换到 `enforce`
2. **性能影响**: RPC 通信有轻微性能开销，通常 < 5ms/调用
3. **兼容性**: 仅在 Hermes >= 0.9.0 测试过
