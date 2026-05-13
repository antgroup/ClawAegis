#!/usr/bin/env bash
# ClawAegis Hermes 适配器安装脚本
#
# 使用方法:
#   cd /path/to/ClawAegis && bash adapters/hermes/install_ZH.sh
#
# 功能说明:
#   1. 编译 TypeScript (npm run build)
#   2. 将适配器复制到 ~/.hermes/plugins/claw-aegis/
#   3. 创建默认配置文件 config.yaml（如果不存在）
#   4. 创建 .clawaegis-root 标记文件指向源码位置
#   5. 检查 Hermes 配置是否存在潜在冲突
#
# 注意: Hermes 没有内置的 plugin 安装命令。
# 插件通过放入 ~/.hermes/plugins/ 目录自动加载。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HERMES_PLUGIN_DIR="${HOME}/.hermes/plugins/claw-aegis"
HERMES_CONFIG="${HOME}/.hermes/config.yaml"
HERMES_STATE_DIR="${HOME}/.hermes/claw-aegis-state"

echo "==> ClawAegis Hermes 适配器安装程序"
echo "    仓库根目录:   $REPO_ROOT"
echo "    插件目录:     $HERMES_PLUGIN_DIR"
echo ""

# 检查 prerequisites
echo "==> 检查环境依赖..."

if ! command -v node &> /dev/null; then
    echo "    错误: 未找到 Node.js。请安装 Node.js >= 20。"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "    警告: Node.js 版本低于 20。ClawAegis 可能无法正常工作。"
fi

echo "    Node.js: $(node --version)"

# 检查 Hermes 是否已安装
if ! command -v hermes &> /dev/null; then
    echo "    警告: 未在 PATH 中找到 Hermes 命令。"
    echo "    请确保 Hermes 已安装后再使用此插件。"
else
    echo "    Hermes: $(hermes --version 2>/dev/null || echo '已安装')"
fi

echo ""

# 1. 编译 TypeScript
echo "==> 编译 TypeScript..."
cd "$REPO_ROOT"
if [ ! -d node_modules ]; then
    echo "    正在安装依赖..."
    npm install
fi

if ! npx tsc --project tsconfig.json; then
    echo "    错误: TypeScript 编译失败。"
    exit 1
fi

# 验证 rpc-server.js 是否存在
if [ ! -f "$REPO_ROOT/rpc-server.js" ]; then
    echo "    错误: 编译后未找到 rpc-server.js。"
    exit 1
fi

echo "    编译成功。"
echo ""

# 2. 构建 Web API
echo "==> 构建 Web UI..."
cd "$REPO_ROOT/web/api-hermes"
if [ ! -d node_modules ]; then
    echo "    正在安装 Web 依赖..."
    npm install
fi
if ! npm run build; then
    echo "    警告: Web UI 构建失败，Web 界面将不可用。"
else
    echo "    Web UI 构建成功。"
fi
cd "$REPO_ROOT"
echo ""

# 3. 创建插件目录
echo "==> 安装插件到 Hermes..."
mkdir -p "$HERMES_PLUGIN_DIR"

# 如果已存在，先备份
if [ -d "$HERMES_PLUGIN_DIR" ] && [ ! -L "$HERMES_PLUGIN_DIR" ]; then
    BACKUP_DIR="${HERMES_PLUGIN_DIR}.backup.$(date +%Y%m%d%H%M%S)"
    echo "    备份现有目录到: $BACKUP_DIR"
    mv "$HERMES_PLUGIN_DIR" "$BACKUP_DIR"
fi

# 移除软链接
if [ -L "$HERMES_PLUGIN_DIR" ]; then
    rm "$HERMES_PLUGIN_DIR"
fi

# 创建新的插件目录
mkdir -p "$HERMES_PLUGIN_DIR"

# 复制 Python 适配器文件
echo "    复制 Python 适配器文件..."
cp "$SCRIPT_DIR/__init__.py" "$HERMES_PLUGIN_DIR/"
cp "$SCRIPT_DIR/plugin.yaml" "$HERMES_PLUGIN_DIR/"
cp "$SCRIPT_DIR/bridge.py" "$HERMES_PLUGIN_DIR/"
cp "$SCRIPT_DIR/tool_wrappers.py" "$HERMES_PLUGIN_DIR/"
cp "$SCRIPT_DIR/paths.py" "$HERMES_PLUGIN_DIR/"
cp "$SCRIPT_DIR/web-server.py" "$HERMES_PLUGIN_DIR/"

# 复制编译后的 RPC 服务器
echo "    复制 RPC 服务器..."
cp "$REPO_ROOT/rpc-server.js" "$HERMES_PLUGIN_DIR/"
cp "$REPO_ROOT/rpc-handlers.js" "$HERMES_PLUGIN_DIR/"

# 复制必要的 src/ 文件
echo "    复制运行时依赖..."
mkdir -p "$HERMES_PLUGIN_DIR/src"
cp "$REPO_ROOT/src/"*.js "$HERMES_PLUGIN_DIR/src/"

# 复制 Web API
echo "    复制 Web API..."
mkdir -p "$HERMES_PLUGIN_DIR/web"
cp -r "$REPO_ROOT/web/api-hermes/dist/"* "$HERMES_PLUGIN_DIR/web/"

# 创建源码根目录标记
echo "$REPO_ROOT" > "$HERMES_PLUGIN_DIR/.clawaegis-root"

echo "    已安装到: $HERMES_PLUGIN_DIR"
echo ""

# 4. 创建默认配置
CONFIG_FILE="$HERMES_PLUGIN_DIR/config.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "==> 创建默认配置文件 config.yaml..."
    cat > "$CONFIG_FILE" << 'YAML'
# ClawAegis 配置文件 - Hermes 适配器
# 默认启用所有防御措施，模式为 enforce（强制执行）
# 如需调整，可将某项设为 false 或将其模式改为 "observe"/"off"

allDefensesEnabled: true
defaultBlockingMode: enforce

# --- Web UI 配置 ---
# 设置 webPort 启用 Web 管理界面（例如 3800）
# 设置为 0 或删除此行则禁用 Web UI
webPort: 3800

# --- 单项防御开关 ---
# selfProtectionEnabled: true
# selfProtectionMode: enforce
# commandBlockEnabled: true
# commandBlockMode: enforce
# encodingGuardEnabled: true
# encodingGuardMode: enforce
# scriptProvenanceGuardEnabled: true
# memoryGuardEnabled: true
# userRiskScanEnabled: true
# skillScanEnabled: true
# toolResultScanEnabled: true
# outputRedactionEnabled: true
# promptGuardEnabled: true
# loopGuardEnabled: true
# exfiltrationGuardMode: enforce
# toolCallEnforcementEnabled: true
# dispatchGuardEnabled: true

# --- 受保护路径（额外添加）---
# protectedPaths:
#   - /path/to/sensitive/dir

# --- 受保护技能 ---
# protectedSkills:
#   - important-skill

# --- 受保护插件 ---
# protectedPlugins:
#   - audit-guard
YAML
    echo "    已创建: $CONFIG_FILE"
else
    echo "    配置文件已存在，跳过创建。"
fi
echo ""

# 5. 状态目录
echo "==> 配置状态存储目录..."
mkdir -p "$HERMES_STATE_DIR"
echo "    状态目录: $HERMES_STATE_DIR"
echo ""

# 6. 检查 Hermes 配置
echo "==> 检查 Hermes 配置..."
if [ -f "$HERMES_CONFIG" ]; then
    if command -v yq &> /dev/null; then
        APPROVAL_MODE=$(yq e '.approvals.mode // "manual"' "$HERMES_CONFIG" 2>/dev/null || echo "manual")
        if [ "$APPROVAL_MODE" = "manual" ]; then
            echo "    警告: Hermes approvals.mode 为 'manual'"
            echo "    你可能会看到双重确认提示。"
            echo "    建议在 $HERMES_CONFIG 中设置 'approvals.mode: off'"
            echo "    让 ClawAegis 统一处理拦截。"
        elif [ "$APPROVAL_MODE" = "smart" ]; then
            echo "    提示: Hermes approvals.mode 为 'smart'"
            echo "    建议设置为 'approvals.mode: off' 以获得完整的 ClawAegis 保护。"
        else
            echo "    正常: Hermes approvals.mode 为 '$APPROVAL_MODE'"
        fi
    else
        echo "    提示: 安装 'yq' 可自动检查配置"
        echo "    (https://github.com/mikefarah/yq)"
    fi
else
    echo "    提示: 未找到 Hermes 配置文件 $HERMES_CONFIG"
fi
echo ""

# 7. 总结
echo "==> 安装完成！"
echo ""
echo "    后续步骤:"
echo "    1. 重启 Hermes 以激活 ClawAegis"
echo "    2. 查看配置文件: $CONFIG_FILE"
echo "    3. 如需启用 Web UI，在配置文件中添加: webPort: 3800"
echo ""
echo "    重要说明:"
echo "    - ClawAegis 通过工具包装器实现拦截（Hermes 的 pre_tool_call 无法直接拦截）"
echo "    - 建议在 Hermes 配置中设置 'approvals.mode: off' 以避免双重提示"
echo "    - 拦截日志存储在: $HERMES_STATE_DIR"
echo "    - 如需卸载，直接删除 $HERMES_PLUGIN_DIR 即可"
echo ""
echo "    Web UI 使用说明:"
echo "    - 设置 webPort: 3800 启用 Web 管理界面（访问 http://localhost:3800）"
echo "    - 或运行独立模式: $REPO_ROOT/start-web-hermes.sh"
echo "    - Web UI 功能：防御状态监控、配置管理、安全事件查看、可信技能管理"
echo ""
