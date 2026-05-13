/**
 * RPC method handlers for ClawAegis.
 *
 * This module creates an agent-agnostic runtime that exposes the core
 * security checks as simple request/response methods, without depending
 * on the OpenClaw plugin API.  It is consumed by rpc-server.ts (stdio
 * JSON-RPC bridge) so that Hermes (Python) can call the same detection
 * engine that OpenClaw uses natively.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ClawAegisPluginConfig, DefenseMode } from "./src/config.js";
import {
  CLAW_AEGIS_PLUGIN_ID,
  DEFENSE_EVENTS_FILENAME,
  SKILL_SCAN_EVENTS_FILENAME,
  STARTUP_SCAN_BUDGET_MS,
} from "./src/config.js";
import {
  buildDynamicPromptContext,
  buildLoopGuardStableArgsKey,
  buildStaticSystemContext,
  collectScriptArtifactRecords,
  collectSensitiveOutputValues,
  collectToolResultScanText,
  detectCommandObfuscationViolation,
  detectHighRiskCommand,
  detectUserRiskFlags,
  isOutboundToolCall,
  normalizeToolName,
  normalizeToolParamsForGuard,
  resolveInlineExecutionViolation,
  resolveMemoryGuardViolation,
  resolveOutsideWorkspaceDeletionViolation,
  resolveProtectedPathCandidates,
  resolveProtectedPathViolation,
  resolveScriptProvenanceViolation,
  resolveSelfProtectionTextViolation,
  reviewSuspiciousOutboundChain,
  sanitizeAssistantMessage,
  sanitizeSensitiveOutputText,
  scanToolResultText,
} from "./src/rules.js";
import {
  TOOL_CALL_DEFENSE_STRATEGIES,
  type ToolCallDefenseContext,
  type ToolCallDefenseEvaluation,
  type ToolCallDefenseModeSource,
  type ToolCallDefenseModes,
  type ToolCallDefenseStrategy,
} from "./src/security-strategies.js";
import { SkillScanService } from "./src/scan-service.js";
import { ClawAegisState } from "./src/state.js";
import type { AegisLogger } from "./src/types.js";

// Define AgentMessage locally since it's not exported from types.ts
type AgentMessage = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RpcRequest = {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

export type RpcResponse = {
  id: number | string;
  result?: unknown;
  error?: { message: string; code?: number };
};

type CheckBeforeToolParams = {
  tool: string;
  args: Record<string, unknown>;
  sessionKey?: string;
  runId?: string;
};

type CheckBeforeToolResult = {
  block: boolean;
  mode: DefenseMode;
  defense?: string;
  reason?: string;
  severity?: string;
  details?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Runtime (agent-agnostic)
// ---------------------------------------------------------------------------

export class AegisRpcRuntime {
  private config!: ClawAegisPluginConfig;
  private state!: ClawAegisState;
  private scanService!: SkillScanService;
  private logger: AegisLogger;
  private stateDir!: string;
  private pluginRootDir!: string;
  private staticSystemContext: string | undefined;
  private initialized = false;
  private defenseEventWriter!: (event: Record<string, unknown>) => void;

  constructor() {
    this.logger = {
      debug: (msg, meta) => console.error(`[aegis:debug] ${msg}`, meta ? JSON.stringify(meta) : ""),
      info: (msg, meta) => console.error(`[aegis:info] ${msg}`, meta ? JSON.stringify(meta) : ""),
      warn: (msg, meta) => console.error(`[aegis:warn] ${msg}`, meta ? JSON.stringify(meta) : ""),
      error: (msg, meta) => console.error(`[aegis:error] ${msg}`, meta ? JSON.stringify(meta) : ""),
    };
  }

  // -----------------------------------------------------------------------
  // init
  // -----------------------------------------------------------------------

  async init(params: {
    config: Partial<ClawAegisPluginConfig>;
    stateDir: string;
    pluginRootDir: string;
    skillRoots?: string[];
    protectedRoots?: string[];
  }): Promise<{ ok: true }> {
    this.stateDir = params.stateDir;
    this.pluginRootDir = params.pluginRootDir;
    this.config = this.resolveConfig(params.config);
    this.state = new ClawAegisState({
      stateDir: this.stateDir,
      logger: this.logger,
    });

    await fs.mkdir(this.stateDir, { recursive: true });
    await this.state.loadPersistentState();

    if (params.protectedRoots) {
      this.state.setProtectedRoots(params.protectedRoots);
    }

    this.staticSystemContext = this.config.promptGuardEnabled
      ? buildStaticSystemContext({
          selfProtectionEnabled: this.config.selfProtectionEnabled,
          toolCallEnforcementEnabled: this.config.toolCallEnforcementEnabled,
          protectedPaths: this.config.protectedPaths,
        })
      : undefined;

    const emitSkillScanEvent = this.createEventWriter(
      path.join(this.stateDir, SKILL_SCAN_EVENTS_FILENAME),
    );
    this.defenseEventWriter = this.createEventWriter(
      path.join(this.stateDir, DEFENSE_EVENTS_FILENAME),
    );
    this.scanService = new SkillScanService({
      state: this.state,
      logger: this.logger,
      onScanComplete: emitSkillScanEvent,
    });

    if (this.config.skillScanEnabled && this.config.startupSkillScan && params.skillRoots) {
      const deadline = Date.now() + STARTUP_SCAN_BUDGET_MS;
      for (const root of params.skillRoots) {
        if (Date.now() >= deadline) break;
        await this.scanService.scanRoots({ roots: [root], budgetMs: deadline - Date.now() }).catch(() => undefined);
      }
    }

    this.initialized = true;
    this.logger.info("claw-aegis RPC runtime initialized");
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // check_user_input
  // -----------------------------------------------------------------------

  checkUserInput(params: {
    content: string;
    sessionKey?: string;
  }): { riskFlags: string[]; context?: string } {
    this.ensureInit();
    if (!this.config.userRiskScanEnabled) {
      return { riskFlags: [] };
    }
    const match = detectUserRiskFlags(params.content);
    const flags = match?.flags ?? [];

    if (flags.length > 0 && params.sessionKey) {
      this.state.noteUserRisk(params.sessionKey, flags);

      // Record defense event for Web UI
      this.defenseEventWriter({
        defense: "userRiskScan",
        mode: "observe",
        reason: `User risk flags detected: ${flags.join(", ")}`,
        severity: flags.some((f) => f.includes("disable")) ? "high" : "medium",
        blocked: false,
        details: { flags },
        userInput: params.content.slice(0, 200),
      });
    }

    return { riskFlags: flags };
  }

  // -----------------------------------------------------------------------
  // get_prompt_guard
  // -----------------------------------------------------------------------

  getPromptGuard(params: {
    sessionKey?: string;
  }): { context: string | null } {
    this.ensureInit();
    if (!this.config.promptGuardEnabled) {
      return { context: null };
    }

    const turnState = params.sessionKey
      ? this.state.consumePromptState(params.sessionKey)
      : undefined;

    const dynamicContext = turnState
      ? buildDynamicPromptContext(turnState)
      : undefined;

    const parts: string[] = [];
    if (this.staticSystemContext) parts.push(this.staticSystemContext);
    if (dynamicContext) parts.push(dynamicContext);

    return { context: parts.length > 0 ? parts.join("\n\n") : null };
  }

  // -----------------------------------------------------------------------
  // check_before_tool
  // -----------------------------------------------------------------------

  checkBeforeTool(params: CheckBeforeToolParams): CheckBeforeToolResult {
    this.ensureInit();
    const tool = normalizeToolName(params.tool);
    const args = normalizeToolParamsForGuard(params.args);
    const runId = params.runId ?? "unknown";
    const sessionKey = params.sessionKey ?? "default";
    const baseDir = process.cwd();

    // Build defense modes (same as OpenClaw handlers.ts)
    const toolCallModes: ToolCallDefenseModes = {
      selfProtection: this.config.selfProtectionMode,
      commandBlock: this.config.commandBlockMode,
      encodingGuard: this.config.encodingGuardMode,
      commandObfuscation: this.mergeDefenseModes(
        this.config.commandBlockMode,
        this.config.encodingGuardMode,
      ),
      scriptProvenanceGuard: this.config.scriptProvenanceGuardMode,
      memoryGuard: this.config.memoryGuardMode,
      loopGuard: this.config.loopGuardMode,
      exfiltrationGuard: this.config.exfiltrationGuardMode,
    };

    // Check if any strategy is enabled
    const hasAnyEnabledStrategy = TOOL_CALL_DEFENSE_STRATEGIES.some((strategy) =>
      this.resolveToolCallDefenseMode(toolCallModes, strategy.modeSource) !== "off",
    );
    if (!hasAnyEnabledStrategy) {
      return { block: false, mode: "off" };
    }

    const protectedRoots = this.config.selfProtectionMode !== "off"
      ? this.state.getProtectedRoots()
      : [];
    const pathCandidates = resolveProtectedPathCandidates(tool, args, baseDir);
    const previousToolCalls = runId ? this.state.peekRunToolCalls(runId) : [];
    const observedSecrets = sessionKey ? this.state.peekObservedSecrets(sessionKey) : [];
    const runSecurityState = runId ? this.state.peekRunSecurityState(runId) : undefined;
    const promptSnapshot = sessionKey ? this.state.peekPromptSnapshot(sessionKey) : undefined;
    const commandText = this.readCommandText(args);

    // Build context (same structure as OpenClaw handlers.ts)
    const toolCallContext: ToolCallDefenseContext = {
      toolName: tool,
      params: args,
      commandText,
      sessionKey,
      runId,
      baseDir,
      protectedRoots,
      pathCandidates,
      previousToolCalls,
      observedSecrets,
      runSecurityState,
      promptSnapshot,
      protectedSkills: this.config.protectedSkills,
      protectedPlugins: this.config.protectedPlugins,
      now: () => Date.now(),
      modes: toolCallModes,
      helpers: {
        resolveSelfProtectionTextViolation,
        resolveOutsideWorkspaceDeletionViolation,
        resolveProtectedPathViolation,
        detectCommandObfuscationViolation,
        detectHighRiskCommand,
        resolveInlineExecutionViolation,
        resolveMemoryGuardViolation,
        resolveScriptProvenanceViolation,
        reviewSuspiciousOutboundChain,
        buildLoopGuardStableArgsKey,
        isOutboundToolCall,
      },
      state: {
        incrementLoopCounter: (sk, rid, key) =>
          this.state.incrementLoopCounter(sk, rid, key),
        noteRunSecuritySignals: (rid, payload) =>
          this.state.noteRunSecuritySignals(rid, payload),
        noteRuntimeRisk: (sk, flags) =>
          this.state.noteRuntimeRisk(sk, flags),
        noteRunToolCall: (rid, record) =>
          this.state.noteRunToolCall(rid, record),
      },
    };

    // Evaluate strategies (same loop as OpenClaw handlers.ts)
    for (const strategy of TOOL_CALL_DEFENSE_STRATEGIES) {
      if (!strategy.appliesTo(toolCallContext)) {
        continue;
      }

      const evaluation: ToolCallDefenseEvaluation = strategy.evaluate(toolCallContext);

      if (evaluation.result === "blocked") {
        const mode = this.resolveToolCallDefenseMode(toolCallModes, strategy.modeSource);
        this.emitDefenseEvent({
          defense: strategy.id,
          mode,
          reason: evaluation.reason ?? "unknown",
          severity: "high",
          blocked: true,
          details: evaluation.extra,
        });
        return {
          block: true,
          mode,
          defense: strategy.id,
          reason: evaluation.reason ?? "unknown",
          severity: "high",
          details: evaluation.extra ?? {},
        };
      }

      if (evaluation.result === "observed") {
        const mode = this.resolveToolCallDefenseMode(toolCallModes, strategy.modeSource);
        this.emitDefenseEvent({
          defense: strategy.id,
          mode,
          reason: evaluation.reason ?? "unknown",
          severity: "medium",
          blocked: false,
          details: evaluation.extra,
        });
        // Continue checking — observe does not block
        continue;
      }
    }

    // --- track state for future checks ---
    this.state.noteRunToolCall(runId, {
      runId,
      sessionKey,
      toolName: tool,
      params: args,
      timestamp: Date.now(),
    });

    // track script artifacts from write_file/patch
    if (["write_file", "patch", "write", "edit"].includes(tool)) {
      const artifacts = collectScriptArtifactRecords(tool, args, { runId, sessionKey, timestamp: Date.now() });
      if (artifacts.length > 0) {
        this.state.noteRunScriptArtifacts(runId, { sessionKey, artifacts });
      }
    }

    return { block: false, mode: "off" };
  }

  // -----------------------------------------------------------------------
  // check_tool_result
  // -----------------------------------------------------------------------

  checkToolResult(params: {
    tool: string;
    args: Record<string, unknown>;
    result: string;
    sessionKey?: string;
    runId?: string;
  }): { riskFlags: string[]; suspicious: boolean } {
    this.ensureInit();
    if (!this.config.toolResultScanEnabled) {
      return { riskFlags: [], suspicious: false };
    }

    const message: AgentMessage = { content: params.result };
    const textResult = collectToolResultScanText(message);
    const text = typeof textResult === 'string' ? textResult : textResult.text || '';
    const outcome = scanToolResultText(text, textResult.oversize || false);
    const sessionKey = params.sessionKey ?? "default";

    if (outcome.riskFlags.length > 0 || outcome.suspicious) {
      this.state.noteToolResult(sessionKey, outcome);

      // Track encoded risk flags as runtime risks (matches OpenClaw behavior)
      const encodedRiskFlags = outcome.riskFlags.filter((flag: string) => flag.startsWith("encoded-"));
      if (encodedRiskFlags.length > 0) {
        this.state.noteRuntimeRisk(sessionKey, encodedRiskFlags);
      }

      // Emit defense event for Web UI (matches OpenClaw behavior)
      this.emitDefenseEvent({
        defense: "tool_result_scan",
        mode: "observe",
        reason: `风险标记: ${outcome.riskFlags.join(", ") || "suspicious"}`,
        severity: "medium",
        blocked: false,
        details: { flags: outcome.riskFlags, suspicious: outcome.suspicious, tool: params.tool },
      });
    }

    // track source signals for exfiltration detection
    if (params.runId) {
      const runState = this.state.peekRunSecurityState(params.runId);
      if (!runState) {
        this.state.noteRunSecuritySignals(params.runId, {
          sessionKey,
          sourceSignals: outcome.riskFlags,
        });
      }
    }

    // collect secrets for redaction tracking
    if (this.config.outputRedactionEnabled) {
      const secrets = collectSensitiveOutputValues(params.result);
      if (secrets.length > 0) {
        this.state.noteObservedSecrets(sessionKey, secrets);
        if (params.runId) {
          const fingerprints = secrets
            .filter((s) => s.length >= 8)
            .map((s) => ({
              hash: createHash("sha256").update(s).digest("hex"),
              length: s.length,
              source: params.tool,
              updatedAt: Date.now(),
            }));
          if (fingerprints.length > 0) {
            this.state.noteRunSecretFingerprints(params.runId, {
              sessionKey,
              fingerprints,
            });
          }
        }
      }
    }

    return {
      riskFlags: outcome.riskFlags,
      suspicious: outcome.suspicious,
    };
  }

  // -----------------------------------------------------------------------
  // redact_output
  // -----------------------------------------------------------------------

  redactOutput(params: {
    text: string;
    sessionKey?: string;
  }): { text: string; redacted: boolean } {
    this.ensureInit();
    if (!this.config.outputRedactionEnabled) {
      return { text: params.text, redacted: false };
    }

    const sessionKey = params.sessionKey ?? "default";
    const secrets = this.state.peekObservedSecrets(sessionKey);
    const options = secrets.length > 0 ? { observedSecrets: secrets } : {};
    const outcome = sanitizeSensitiveOutputText(params.text, options);
    return {
      text: outcome.value,
      redacted: outcome.changed,
    };
  }

  // -----------------------------------------------------------------------
  // update_state
  // -----------------------------------------------------------------------

  updateState(params: {
    method: string;
    sessionKey?: string;
    runId?: string;
    data?: Record<string, unknown>;
  }): { ok: true } {
    this.ensureInit();
    const sessionKey = params.sessionKey ?? "default";
    const runId = params.runId ?? "unknown";

    switch (params.method) {
      case "clear_session":
        this.state.clearSessionRuntimeState(sessionKey);
        break;
      case "clear_run":
        this.state.clearRunToolCalls(runId);
        this.state.clearRunSecurityState(runId);
        break;
      case "note_user_input":
        if (typeof params.data?.content === "string") {
          this.state.noteLastUserInput(sessionKey, params.data.content);
        }
        break;
      default:
        break;
    }

    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // get_config
  // -----------------------------------------------------------------------

  getConfig(): ClawAegisPluginConfig {
    this.ensureInit();
    return { ...this.config };
  }

  // -----------------------------------------------------------------------
  // scan_skills
  // -----------------------------------------------------------------------

  async scanSkills(params: { roots: string[] }): Promise<{ scanned: number }> {
    this.ensureInit();
    if (!this.config.skillScanEnabled) {
      return { scanned: 0 };
    }
    await this.scanService.scanRoots({ roots: params.roots }).catch(() => undefined);
    await this.state.persistTrustedSkills().catch(() => undefined);
    return { scanned: params.roots.length };
  }

  // -----------------------------------------------------------------------
  // dispatch
  // -----------------------------------------------------------------------

  async dispatch(request: RpcRequest): Promise<RpcResponse> {
    const { id, method, params = {} } = request;
    try {
      let result: unknown;
      switch (method) {
        case "init":
          result = await this.init(params as Parameters<typeof this.init>[0]);
          break;
        case "check_user_input":
          result = this.checkUserInput(params as Parameters<typeof this.checkUserInput>[0]);
          break;
        case "get_prompt_guard":
          result = this.getPromptGuard(params as Parameters<typeof this.getPromptGuard>[0]);
          break;
        case "check_before_tool":
          result = this.checkBeforeTool(params as Parameters<typeof this.checkBeforeTool>[0]);
          break;
        case "check_tool_result":
          result = this.checkToolResult(params as Parameters<typeof this.checkToolResult>[0]);
          break;
        case "redact_output":
          result = this.redactOutput(params as Parameters<typeof this.redactOutput>[0]);
          break;
        case "update_state":
          result = this.updateState(params as Parameters<typeof this.updateState>[0]);
          break;
        case "get_config":
          result = this.getConfig();
          break;
        case "scan_skills":
          result = await this.scanSkills(params as Parameters<typeof this.scanSkills>[0]);
          break;
        case "ping":
          result = { pong: true, initialized: this.initialized };
          break;
        default:
          return { id, error: { message: `Unknown method: ${method}`, code: -32601 } };
      }
      return { id, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`RPC method ${method} failed: ${message}`);
      return { id, error: { message, code: -32000 } };
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error("AegisRpcRuntime not initialized — call init first");
    }
  }

  private readCommandText(args: Record<string, unknown>): string | undefined {
    for (const key of ["command", "cmd", "code", "script"]) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private mergeDefenseModes(...modes: DefenseMode[]): DefenseMode {
    if (modes.includes("enforce")) return "enforce";
    if (modes.includes("observe")) return "observe";
    return "off";
  }

  private resolveToolCallDefenseMode(
    modes: ToolCallDefenseModes,
    source: ToolCallDefenseModeSource | readonly ToolCallDefenseModeSource[],
  ): DefenseMode {
    const sources: readonly ToolCallDefenseModeSource[] = Array.isArray(source) ? source : [source];
    return this.mergeDefenseModes(...sources.map((entry) => modes[entry]));
  }

  private emitDefenseEvent(event: Record<string, unknown>): void {
    const line = JSON.stringify({ ...event, timestamp: Date.now() }) + "\n";
    const filePath = path.join(this.stateDir, DEFENSE_EVENTS_FILENAME);
    const dir = this.stateDir;
    const doWrite = async () => {
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(filePath, line, "utf8");
    };
    doWrite().catch((err) => {
      this.logger.error(`Failed to write defense event to ${filePath}: ${err}`);
    });
  }

  private createEventWriter(filePath: string) {
    const dir = path.dirname(filePath);
    let ensured = false;
    return (event: Record<string, unknown>): void => {
      const line = JSON.stringify({ ...event, timestamp: Date.now() }) + "\n";
      const doWrite = async () => {
        if (!ensured) {
          await fs.mkdir(dir, { recursive: true });
          ensured = true;
        }
        await fs.appendFile(filePath, line, "utf8");
      };
      doWrite().catch((err) => {
        this.logger.error(`Failed to write defense event to ${filePath}: ${err}`);
      });
    };
  }

  private resolveConfig(raw: Partial<ClawAegisPluginConfig>): ClawAegisPluginConfig {
    const allDefensesEnabled = raw.allDefensesEnabled !== false;
    const defaultBlockingMode = raw.defaultBlockingMode ?? "enforce";

    const resolveMode = (
      enabled: boolean | undefined,
      mode: DefenseMode | undefined,
    ): DefenseMode => {
      if (!allDefensesEnabled || enabled === false) return "off";
      return mode ?? defaultBlockingMode;
    };

    return {
      allDefensesEnabled,
      defaultBlockingMode,
      selfProtectionEnabled: allDefensesEnabled && raw.selfProtectionEnabled !== false,
      selfProtectionMode: resolveMode(raw.selfProtectionEnabled, raw.selfProtectionMode),
      commandBlockEnabled: allDefensesEnabled && raw.commandBlockEnabled !== false,
      commandBlockMode: resolveMode(raw.commandBlockEnabled, raw.commandBlockMode),
      encodingGuardEnabled: allDefensesEnabled && raw.encodingGuardEnabled !== false,
      encodingGuardMode: resolveMode(raw.encodingGuardEnabled, raw.encodingGuardMode),
      scriptProvenanceGuardEnabled:
        allDefensesEnabled && raw.scriptProvenanceGuardEnabled !== false,
      scriptProvenanceGuardMode: resolveMode(
        raw.scriptProvenanceGuardEnabled,
        raw.scriptProvenanceGuardMode,
      ),
      memoryGuardEnabled: allDefensesEnabled && raw.memoryGuardEnabled !== false,
      memoryGuardMode: resolveMode(raw.memoryGuardEnabled, raw.memoryGuardMode),
      userRiskScanEnabled: allDefensesEnabled && raw.userRiskScanEnabled !== false,
      skillScanEnabled: allDefensesEnabled && raw.skillScanEnabled !== false,
      toolResultScanEnabled: allDefensesEnabled && raw.toolResultScanEnabled !== false,
      outputRedactionEnabled: allDefensesEnabled && raw.outputRedactionEnabled !== false,
      promptGuardEnabled: allDefensesEnabled && raw.promptGuardEnabled !== false,
      loopGuardEnabled: allDefensesEnabled && raw.loopGuardEnabled !== false,
      loopGuardMode: resolveMode(raw.loopGuardEnabled, raw.loopGuardMode),
      exfiltrationGuardEnabled: allDefensesEnabled && raw.exfiltrationGuardEnabled !== false,
      exfiltrationGuardMode: resolveMode(raw.exfiltrationGuardEnabled, raw.exfiltrationGuardMode),
      toolCallEnforcementEnabled:
        allDefensesEnabled && raw.toolCallEnforcementEnabled !== false,
      dispatchGuardEnabled: allDefensesEnabled && raw.dispatchGuardEnabled !== false,
      dispatchGuardMode: resolveMode(raw.dispatchGuardEnabled, raw.dispatchGuardMode),
      protectedPaths: raw.protectedPaths ?? [],
      protectedSkills: raw.protectedSkills ?? [],
      protectedPlugins: raw.protectedPlugins ?? [],
      skillRoots: raw.skillRoots ?? [],
      extraProtectedRoots: raw.extraProtectedRoots ?? [],
      startupSkillScan: raw.startupSkillScan !== false,
    };
  }
}
