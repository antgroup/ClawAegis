"""
ClawAegis plugin for Hermes Agent.

This plugin bridges the ClawAegis TypeScript security engine into Hermes
via a Node.js subprocess running a JSON-RPC server.  It registers lifecycle
hooks and wraps high-risk tool handlers to enforce the same defense-in-depth
protections available in the OpenClaw version.

Installation:
    ln -s /path/to/ClawAegis/adapters/hermes ~/.hermes/plugins/claw-aegis
    cd /path/to/ClawAegis && npm run build
"""

from __future__ import annotations

import atexit
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("claw-aegis")

# ---------------------------------------------------------------------------
# Session state tracking (module-level so hooks and wrappers share it)
# ---------------------------------------------------------------------------

_current_session_id: str = "default"
_current_run_id: str = "unknown"


def _get_session_key() -> str:
    return _current_session_id


def _get_run_id() -> str:
    return _current_run_id


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def _load_config() -> dict:
    """Load ClawAegis config from ~/.hermes/plugins/claw-aegis/config.yaml
    or fall back to defaults (all defenses enabled, enforce mode).
    """
    try:
        import yaml
    except ImportError:
        logger.debug("PyYAML not available, using default config")
        return {}

    config_path = Path(os.path.expanduser("~/.hermes/plugins/claw-aegis/config.yaml"))
    if not config_path.is_file():
        logger.debug("No config.yaml found at %s, using defaults", config_path)
        return {}

    try:
        with open(config_path) as f:
            data = yaml.safe_load(f) or {}
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("Failed to load config.yaml: %s", exc)
        return {}


def _resolve_paths() -> dict:
    """Resolve Hermes-specific paths for the ClawAegis runtime."""
    hermes_home = Path(os.path.expanduser("~/.hermes"))
    state_dir = str(hermes_home / "plugins" / "claw-aegis" / "state")
    plugin_root = str(Path(__file__).resolve().parent.parent.parent)

    skill_roots = []
    skills_dir = hermes_home / "skills"
    if skills_dir.is_dir():
        skill_roots.append(str(skills_dir))

    protected_roots = [
        str(hermes_home / "plugins" / "claw-aegis"),
        str(hermes_home),
        plugin_root,
    ]

    return {
        "state_dir": state_dir,
        "plugin_root": plugin_root,
        "skill_roots": skill_roots,
        "protected_roots": protected_roots,
    }


# ---------------------------------------------------------------------------
# Hook handlers
# ---------------------------------------------------------------------------

def _make_session_start_handler(engine):
    def handler(**kwargs):
        global _current_session_id
        session_id = kwargs.get("session_id", "default")
        _current_session_id = session_id
        logger.debug("Session started: %s", session_id)
    return handler


def _make_session_end_handler(engine):
    def handler(**kwargs):
        session_id = kwargs.get("session_id", _current_session_id)
        engine.call_safe("update_state", {
            "method": "clear_session",
            "sessionKey": session_id,
        })
        logger.debug("Session ended: %s", session_id)
    return handler


def _make_pre_llm_call_handler(engine):
    def handler(**kwargs):
        global _current_run_id
        session_id = kwargs.get("session_id", _current_session_id)
        _current_run_id = f"{session_id}:{id(kwargs)}"

        user_message = kwargs.get("user_message", "")
        context_parts: list = []

        # 1. Check user input for jailbreak / exfiltration intent
        if user_message:
            result = engine.call_safe("check_user_input", {
                "content": str(user_message),
                "sessionKey": session_id,
            })
            if result.get("riskFlags"):
                logger.info(
                    "User risk flags detected: %s", result["riskFlags"],
                )

            # Track user input for state
            engine.call_safe("update_state", {
                "method": "note_user_input",
                "sessionKey": session_id,
                "data": {"content": str(user_message)[:500]},
            })

        # 2. Get prompt guard context to inject
        guard_result = engine.call_safe("get_prompt_guard", {
            "sessionKey": session_id,
        })
        if guard_result.get("context"):
            context_parts.append(guard_result["context"])

        if context_parts:
            return {"context": "\n\n".join(context_parts)}
        return None

    return handler


def _make_post_tool_call_handler(engine):
    def handler(**kwargs):
        tool_name = kwargs.get("tool_name", "")
        args = kwargs.get("args", {})
        result = kwargs.get("result", "")

        if not tool_name:
            return

        # Scan tool results for injection / exfiltration patterns
        engine.call_safe("check_tool_result", {
            "tool": tool_name,
            "args": args if isinstance(args, dict) else {},
            "result": str(result)[:65536],
            "sessionKey": _current_session_id,
            "runId": _current_run_id,
        })

    return handler


def _make_pre_tool_call_handler(engine):
    """Observation-only handler — logs but cannot block (Hermes limitation)."""
    def handler(**kwargs):
        tool_name = kwargs.get("tool_name", "")
        args = kwargs.get("args", {})
        # This is for observability; actual blocking is done via tool wrapping
        logger.debug("pre_tool_call observed: %s", tool_name)
    return handler


# ---------------------------------------------------------------------------
# CLI command
# ---------------------------------------------------------------------------

def _setup_cli_command(subparser):
    sub = subparser.add_subparsers(dest="aegis_action")
    sub.add_parser("status", help="Show defense status")
    sub.add_parser("config", help="Show current configuration")


def _handle_cli_command(args, engine):
    action = getattr(args, "aegis_action", "status")
    if action == "config":
        config = engine.call_safe("get_config")
        if config:
            import json as _json
            print(_json.dumps(config, indent=2, ensure_ascii=False))
        else:
            print("ClawAegis engine not available")
    else:
        # status
        if engine.alive:
            config = engine.call_safe("get_config")
            mode = config.get("defaultBlockingMode", "?") if config else "?"
            enabled = config.get("allDefensesEnabled", "?") if config else "?"
            print(f"ClawAegis: running | defenses={enabled} | mode={mode}")
        else:
            print("ClawAegis: not running")


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def register(ctx):
    """Hermes plugin entry point — register hooks and wrap tools."""
    from .bridge import AegisEngine
    from .tool_wrappers import wrap_dangerous_tools

    engine = AegisEngine()

    try:
        engine.start()
    except FileNotFoundError as exc:
        logger.error("ClawAegis startup failed: %s", exc)
        logger.error("Ensure Node.js is installed and run 'npm run build' in the ClawAegis directory.")
        return

    # Initialize the RPC runtime
    config = _load_config()
    paths = _resolve_paths()

    try:
        engine.call("init", {
            "config": config,
            "stateDir": paths["state_dir"],
            "pluginRootDir": paths["plugin_root"],
            "skillRoots": paths["skill_roots"],
            "protectedRoots": paths["protected_roots"],
        })
    except Exception as exc:
        logger.error("ClawAegis init failed: %s", exc)
        engine.stop()
        return

    # Register hooks
    ctx.register_hook("on_session_start", _make_session_start_handler(engine))
    ctx.register_hook("on_session_end", _make_session_end_handler(engine))
    ctx.register_hook("pre_llm_call", _make_pre_llm_call_handler(engine))
    ctx.register_hook("post_tool_call", _make_post_tool_call_handler(engine))
    ctx.register_hook("pre_tool_call", _make_pre_tool_call_handler(engine))

    # Wrap high-risk tool handlers for blocking capability
    wrap_dangerous_tools(engine, _get_session_key, _get_run_id)

    # Register CLI command
    ctx.register_cli_command(
        name="aegis",
        help="ClawAegis security status and configuration",
        setup_fn=_setup_cli_command,
        handler_fn=lambda args: _handle_cli_command(args, engine),
    )

    # Cleanup on exit
    atexit.register(engine.stop)

    logger.info("ClawAegis plugin registered successfully")
