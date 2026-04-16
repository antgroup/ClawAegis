#!/usr/bin/env bash
# ClawAegis Hermes adapter installer.
#
# Usage:
#   cd /path/to/ClawAegis && bash adapters/hermes/install.sh
#
# What it does:
#   1. Compiles TypeScript (npm run build)
#   2. Symlinks adapters/hermes/ -> ~/.hermes/plugins/claw-aegis/
#   3. Creates default config.yaml if missing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HERMES_PLUGIN_DIR="${HOME}/.hermes/plugins/claw-aegis"

echo "==> ClawAegis Hermes Adapter Installer"
echo "    Repo root:   $REPO_ROOT"
echo "    Plugin dir:  $HERMES_PLUGIN_DIR"
echo ""

# 1. Build TypeScript
echo "==> Building TypeScript..."
cd "$REPO_ROOT"
if [ ! -d node_modules ]; then
    npm install
fi
npx tsc --project tsconfig.json
echo "    Done."

# 2. Symlink
echo "==> Creating symlink..."
mkdir -p "$(dirname "$HERMES_PLUGIN_DIR")"
if [ -L "$HERMES_PLUGIN_DIR" ]; then
    echo "    Removing existing symlink."
    rm "$HERMES_PLUGIN_DIR"
elif [ -d "$HERMES_PLUGIN_DIR" ]; then
    echo "    WARNING: $HERMES_PLUGIN_DIR is a real directory."
    echo "    Please back it up and remove it, then re-run this script."
    exit 1
fi
ln -s "$SCRIPT_DIR" "$HERMES_PLUGIN_DIR"
echo "    Linked: $HERMES_PLUGIN_DIR -> $SCRIPT_DIR"

# 3. Default config
CONFIG_FILE="$HERMES_PLUGIN_DIR/config.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "==> Creating default config.yaml..."
    cat > "$CONFIG_FILE" << 'YAML'
# ClawAegis configuration for Hermes Agent.
# All defenses are enabled by default in enforce mode.
# Set a defense to false or its mode to "observe"/"off" to adjust.

allDefensesEnabled: true
defaultBlockingMode: enforce

# --- Individual defense toggles ---
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
# exfiltrationGuardEnabled: true
# toolCallEnforcementEnabled: true
# dispatchGuardEnabled: true

# --- Protected paths (additional) ---
# protectedPaths:
#   - /path/to/sensitive/dir
YAML
    echo "    Created: $CONFIG_FILE"
else
    echo "    Config already exists, skipping."
fi

# 4. State directory
STATE_DIR="$HERMES_PLUGIN_DIR/state"
mkdir -p "$STATE_DIR"
echo "    State dir: $STATE_DIR"

echo ""
echo "==> Installation complete!"
echo "    Restart Hermes to activate ClawAegis."
