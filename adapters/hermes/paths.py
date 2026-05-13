"""
Path resolution for ClawAegis Hermes adapter.

This module handles finding ClawAegis files in multiple locations:
1. Plugin directory (for installed/standalone mode)
2. Source repository (for development mode)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


# Marker file that indicates the plugin directory
CLAWAEGIS_ROOT_MARKER = ".clawaegis-root"


def _find_source_root() -> Optional[Path]:
    """Find the ClawAegis source repository root from this file's location."""
    # This file is at: adapters/hermes/paths.py
    # Source root is: ../../
    try:
        this_file = Path(__file__).resolve()
        source_root = this_file.parent.parent.parent
        if (source_root / "rpc-server.ts").exists() or (source_root / "rpc-server.js").exists():
            return source_root
    except Exception:
        pass
    return None


def _read_plugin_root_marker(plugin_dir: Path) -> Optional[Path]:
    """Read the source root path from the marker file in plugin directory."""
    marker_file = plugin_dir / CLAWAEGIS_ROOT_MARKER
    if marker_file.exists():
        try:
            root_path = Path(marker_file.read_text().strip()).resolve()
            if root_path.exists():
                return root_path
        except Exception:
            pass
    return None


def get_plugin_directory() -> Path:
    """Get the plugin installation directory."""
    # When installed, __file__ is at: ~/.hermes/plugins/claw-aegis/__init__.py
    # or: ~/.hermes/plugins/claw-aegis/paths.py
    return Path(__file__).resolve().parent


def get_source_root() -> Optional[Path]:
    """Get the ClawAegis source repository root."""
    plugin_dir = get_plugin_directory()

    # 1. Try to read from marker file (installed mode with source reference)
    source_root = _read_plugin_root_marker(plugin_dir)
    if source_root:
        return source_root

    # 2. Try to find relative to this file (development mode)
    source_root = _find_source_root()
    if source_root:
        return source_root

    return None


def find_rpc_server() -> str:
    """Find the rpc-server.js file.

    Searches in order:
    1. Plugin directory (for standalone installation)
    2. Source repository root

    Raises:
        FileNotFoundError: If rpc-server.js cannot be found
    """
    plugin_dir = get_plugin_directory()

    # 1. Check plugin directory (installed mode)
    candidate = plugin_dir / "rpc-server.js"
    if candidate.exists():
        return str(candidate)

    # 2. Check source repository
    source_root = get_source_root()
    if source_root:
        candidate = source_root / "rpc-server.js"
        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError(
        f"Cannot find rpc-server.js. "
        f"Searched in: {plugin_dir}, {source_root or 'N/A'}. "
        f"Please run 'npm run build' in the ClawAegis directory."
    )


def find_web_api() -> str:
    """Find the web/api-hermes/dist/index.js file.

    Searches in order:
    1. Plugin directory web/ subdirectory
    2. Source repository web/api-hermes/dist/

    Raises:
        FileNotFoundError: If web API cannot be found
    """
    plugin_dir = get_plugin_directory()

    # 1. Check plugin directory web/ subdirectory (installed mode)
    candidate = plugin_dir / "web" / "index.js"
    if candidate.exists():
        return str(candidate)

    # 2. Check source repository
    source_root = get_source_root()
    if source_root:
        candidate = source_root / "web" / "api-hermes" / "dist" / "index.js"
        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError(
        f"Cannot find Web API (web/api-hermes/dist/index.js). "
        f"Searched in: {plugin_dir / 'web'}, {source_root / 'web/api-hermes/dist' if source_root else 'N/A'}. "
        f"Please run 'npm run build' in the web/api-hermes directory."
    )


def find_config_template() -> Optional[str]:
    """Find the default config.yaml template."""
    plugin_dir = get_plugin_directory()

    # 1. Check plugin directory
    candidate = plugin_dir / "config.yaml"
    if candidate.exists():
        return str(candidate)

    # 2. Check source repository
    source_root = get_source_root()
    if source_root:
        candidate = source_root / "adapters" / "hermes" / "config.yaml"
        if candidate.exists():
            return str(candidate)

    return None


def get_state_directory() -> str:
    """Get the state directory for ClawAegis in Hermes."""
    return os.path.expanduser("~/.hermes/claw-aegis-state")


def get_config_directory() -> str:
    """Get the config directory (same as plugin directory for Hermes)."""
    return str(get_plugin_directory())


def resolve_hermes_paths() -> dict:
    """Resolve all Hermes-specific paths for ClawAegis runtime.

    Returns a dictionary with:
    - state_dir: State storage directory
    - config_dir: Config directory
    - plugin_root: Plugin installation directory
    - skill_roots: List of skill directories to scan
    - protected_roots: List of paths to protect
    """
    hermes_home = Path(os.path.expanduser("~/.hermes"))
    plugin_dir = get_plugin_directory()

    state_dir = str(hermes_home / "claw-aegis-state")
    config_dir = str(plugin_dir)

    skill_roots = []
    skills_dir = hermes_home / "skills"
    if skills_dir.is_dir():
        skill_roots.append(str(skills_dir))

    protected_roots = [
        str(hermes_home / "plugins" / "claw-aegis"),
        str(hermes_home),
        str(hermes_home / ".env"),
        str(hermes_home / "config.yaml"),
        str(hermes_home / "plugins"),
        str(hermes_home / "skills"),
        str(plugin_dir),
    ]

    return {
        "state_dir": state_dir,
        "config_dir": config_dir,
        "plugin_root": str(plugin_dir),
        "skill_roots": skill_roots,
        "protected_roots": protected_roots,
    }
