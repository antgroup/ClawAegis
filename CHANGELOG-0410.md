# Changelog

All notable changes to ClawAegis will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-04-10 (`webui` branch)

> Compare: `main` (`cee16d0`) → `webui` (HEAD)
>
> The `main` branch already includes all rule enhancements from `e861e26` (symlink resolution via `realpathSync`, `while [1]` loop detection, shell config truncation guards, security-strategies expansions, self-protection tiered logic, etc.). This branch builds on top of those changes without modifying them.

### Added

- **Dispatch Guard** — new `before_dispatch` hook intercepts dangerous operation requests (openclaw CLI commands, destructive path operations, tool-call bypass attempts) *before* they reach the agent, complementing the existing `before_tool_call` defense chain. Configurable via `dispatchGuardEnabled` / `dispatchGuardMode`. ([`src/handlers.ts`], [`src/rules.ts`])
- **Tool Call Enforcement prompts** — inject system-level prompt rules requiring all destructive operations (file I/O, shell commands, network requests, process spawning) to go through standard tool calls only. Includes protected-path enforcement and a destructive-operation confirmation requirement. Controlled by `toolCallEnforcementEnabled`. ([`src/rules.ts`], [`src/security-strategies.ts`])
- **`[ClawAegis]` refusal prefix** — all safety prompt rules now instruct the agent to prefix refusal messages with `[ClawAegis]` for audit traceability. ([`src/security-strategies.ts`])
- **Defense event logging** — all blocked/observed events across every hook are now persisted to `defense-events.jsonl` (JSONL, append-only). Skill scan results are separately logged to `skill-scan-events.jsonl`. ([`src/handlers.ts`], [`src/config.ts`])
- **WebUI dashboard** — browser-based management interface for ClawAegis (React + Express + WebSocket):
  - **Config page** — toggle defenses, set modes, manage protected paths/skills/plugins
  - **Status page** — real-time defense status overview
  - **Events page** — browse and filter defense event log with command/param details
  - **Skills page** — view trusted skills, scan results, and remove entries
  - REST API (`GET/PUT /api/v1/config`, `GET /api/v1/events`, etc.) + WebSocket push
  - i18n support (English / Chinese)
  - See [`web/README.md`] for setup instructions. ([`web/`])
- **Skill scan event callback** — `SkillScanService` now accepts an `onScanComplete` callback, used to emit scan events to the JSONL log. ([`src/scan-service.ts`])
- **Last user input tracking** — `ClawAegisState` now records the most recent user input per session for dispatch guard event context. ([`src/state.ts`])

### Changed

- `protectedSkills` default value removed — previously defaulted to `["ClawHub"]`, now defaults to an empty array. Users should explicitly configure protected skills. ([`src/config.ts`])

### Fixed

- **WebUI config toggles greyed out after save** — `toolCallEnforcementEnabled`, `dispatchGuardEnabled`, and `dispatchGuardMode` were defined in the Zod schema and UI metadata but missing from the `AegisConfig` TypeScript type and the web API's `resolveConfig()` return value. Saving config would drop these fields from the response, causing the frontend to display them as disabled. ([`web/shared/src/types.ts`], [`web/api/src/services/config-service.ts`])

### Security

- Dispatch Guard detects and blocks requests to delete skills/plugins/extensions directories, run openclaw CLI destructive commands, or bypass the tool-call security hook — even if the request appears in natural language (Chinese/English).
- Tool Call Enforcement prevents the agent from performing destructive operations through non-tool-call pathways (e.g., inline code, slash commands, internal APIs).

---

### Migration notes

- **New config keys**: `toolCallEnforcementEnabled` (bool, default `true`), `dispatchGuardEnabled` (bool, default `true`), `dispatchGuardMode` (`"enforce"` / `"observe"` / `"off"`, default `"enforce"`). No action required — defaults apply automatically.
- **New log files**: `defense-events.jsonl` and `skill-scan-events.jsonl` are created in the plugin state directory. No rotation is implemented yet; monitor disk usage on long-running instances.
- **WebUI**: the `web/` directory is self-contained. The API reads/writes `openclaw.plugin.json` (same file as the main runtime). See `web/README.md` for build and startup instructions.
- **Breaking**: `protectedSkills` no longer defaults to `["ClawHub"]`. If you relied on this default, add it explicitly to your config.
