import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookAgentEndEvent,
  PluginHookBeforePromptBuildEvent,
  OpenClawPluginApi,
  PluginHookBeforeMessageWriteEvent,
  PluginHookBeforePromptBuildResult,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookMessageSendingEvent,
  PluginHookMessageSendingResult,
  PluginHookSessionEndEvent,
} from "../runtime-api.js";
import {
  CLAW_AEGIS_PLUGIN_ID,
  STARTUP_SCAN_BUDGET_MS,
} from "./config.js";
import {
  type DefenseMode,
  resolveClawAegisPluginConfig,
  resolveClawAegisStateDir,
  resolveSkillScanRoots,
} from "./config.js";
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
  isThirdPartyWebToolResultMessage,
  normalizeToolName,
  normalizeToolParamsForGuard,
  reviewSuspiciousOutboundChain,
  resolveInlineExecutionViolation,
  resolveMemoryGuardViolation,
  resolveOutsideWorkspaceDeletionViolation,
  resolveProtectedPathCandidates,
  resolveProtectedPathViolation,
  resolveScriptProvenanceViolation,
  resolveSelfProtectionTextViolation,
  sanitizeAssistantMessage,
  sanitizeSensitiveOutputText,
  sanitizeToolResultMessage,
  scanToolResultText,
} from "./rules.js";
import {
  TOOL_CALL_DEFENSE_STRATEGIES,
  type ToolCallDefenseContext,
  type ToolCallDefenseEvaluation,
  type ToolCallDefenseModes,
  type ToolCallDefenseModeSource,
  type ToolCallDefenseStrategy,
} from "./security-strategies.js";
import { SkillScanService } from "./scan-service.js";
import { ClawAegisState } from "./state.js";
import type {
  AegisLogger,
  ScriptArtifactRecord,
  SecretFingerprintRecord,
  TurnSecurityState,
} from "./types.js";
const SELF_INTEGRITY_FILES = [
  "index.ts",
  "runtime-api.ts",
  "openclaw.plugin.json",
  "package.json",
  "src/config.ts",
  "src/types.ts",
  "src/state.ts",
  "src/rules.ts",
  "src/scan-service.ts",
  "src/scan-worker.ts",
  "src/scan-worker.js",
  "src/handlers.ts",
] as const;

function joinPresentTextSegments(segments: Array<string | undefined>): string | undefined {
  const values = segments.map((segment) => segment?.trim()).filter(Boolean);
  return values.length > 0 ? values.join("\n\n") : undefined;
}

function readCommandText(params: Record<string, unknown>): string | undefined {
  for (const key of ["command", "cmd"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function buildSecretFingerprints(
  values: string[],
  source: string,
  timestamp: number,
): SecretFingerprintRecord[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .filter((value) => value.length >= 8)
    .map((value) => ({
      hash: createHash("sha256").update(value).digest("hex"),
      length: value.length,
      source,
      updatedAt: timestamp,
    }));
}

function deriveScriptArtifactSignals(artifacts: ScriptArtifactRecord[]): {
  sourceSignals: string[];
  transformSignals: string[];
  sinkSignals: string[];
  runtimeRiskFlags: string[];
} {
  const sourceSignals = new Set<string>();
  const transformSignals = new Set<string>();
  const sinkSignals = new Set<string>();
  const runtimeRiskFlags = new Set<string>();

  for (const artifact of artifacts) {
    if (artifact.riskFlags.some((flag) => flag.includes("secret") || flag.includes("sensitive"))) {
      sourceSignals.add("script-artifact");
    }
    if (artifact.riskFlags.some((flag) => flag.includes("encoded") || flag.includes("high-risk-command"))) {
      transformSignals.add("script-artifact");
    }
    if (artifact.riskFlags.some((flag) => flag.includes("outbound-sink") || flag.includes("exfiltration"))) {
      sinkSignals.add("script-artifact");
    }
    for (const flag of artifact.riskFlags) {
      runtimeRiskFlags.add(flag);
    }
  }

  return {
    sourceSignals: [...sourceSignals],
    transformSignals: [...transformSignals],
    sinkSignals: [...sinkSignals],
    runtimeRiskFlags: [...runtimeRiskFlags],
  };
}

async function resolveRealPath(input: string | undefined): Promise<string | undefined> {
  if (!input?.trim()) {
    return undefined;
  }
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
}

async function resolveProtectedRoots(api: OpenClawPluginApi, stateDir: string): Promise<string[]> {
  const config = resolveClawAegisPluginConfig(api);
  const stateRoot = path.resolve(api.runtime.state.resolveStateDir());
  const candidates = new Set<string>();
  const append = async (entry: string | undefined) => {
    if (!entry?.trim()) {
      return;
    }
    const resolved = path.resolve(entry);
    candidates.add(resolved);
    const real = await resolveRealPath(resolved);
    if (real) {
      candidates.add(real);
    }
  };

  await append(api.rootDir);
  await append(stateDir);
  for (const protectedPath of config.protectedPaths) {
    await append(protectedPath);
  }
  for (const extra of config.extraProtectedRoots) {
    await append(extra);
  }
  for (const protectedSkillId of config.protectedSkills) {
    await append(path.join(stateRoot, "skills", protectedSkillId));
    await append(path.join(stateRoot, "workspace", "skills", protectedSkillId));
  }
  for (const protectedPluginId of config.protectedPlugins) {
    await append(path.join(stateRoot, "extensions", protectedPluginId));
    await append(path.join(stateRoot, "plugins", protectedPluginId));
  }

  return [...candidates].sort((left, right) => left.localeCompare(right));
}

async function buildSelfIntegrityRecord(params: {
  api: OpenClawPluginApi;
  stateDir: string;
  protectedRoots: string[];
}): Promise<{
  pluginId: string;
  stateDir: string;
  rootDir?: string;
  rootRealPath?: string;
  protectedRoots: string[];
  fingerprints: Record<string, string>;
  updatedAt: number;
}> {
  const rootDir = params.api.rootDir ? path.resolve(params.api.rootDir) : undefined;
  const rootRealPath = await resolveRealPath(rootDir);
  const fingerprints: Record<string, string> = {};

  if (rootDir) {
    for (const relativePath of SELF_INTEGRITY_FILES) {
      const absolutePath = path.join(rootDir, relativePath);
      try {
        const content = await fs.readFile(absolutePath);
        fingerprints[relativePath] = createHash("sha256")
          .update(content)
          .digest("hex")
          .slice(0, 16);
      } catch {
        continue;
      }
    }
  }

  return {
    pluginId: CLAW_AEGIS_PLUGIN_ID,
    stateDir: params.stateDir,
    rootDir,
    rootRealPath,
    protectedRoots: params.protectedRoots,
    fingerprints,
    updatedAt: Date.now(),
  };
}

function createSyntheticSkillRiskState(params: {
  now: number;
  skillRiskFlags: string[];
  riskySkills: string[];
}): TurnSecurityState {
  return {
    userRiskFlags: [],
    hasToolResult: false,
    toolResultRiskFlags: [],
    toolResultSuspicious: false,
    toolResultOversize: false,
    skillRiskFlags: [...params.skillRiskFlags],
    riskySkills: [...params.riskySkills],
    runtimeRiskFlags: [],
    prependNeeded: params.riskySkills.length > 0,
    updatedAt: params.now,
  };
}

function serializeLogMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' {"meta":"[unserializable]"}';
  }
}

function createAegisLogger(api: OpenClawPluginApi): AegisLogger {
  return {
    debug: api.logger.debug
      ? (message, meta) => {
          api.logger.debug?.(`${message}${serializeLogMeta(meta)}`);
        }
      : undefined,
    info: (message, meta) => {
      api.logger.info(`${message}${serializeLogMeta(meta)}`);
    },
    warn: (message, meta) => {
      api.logger.warn(`${message}${serializeLogMeta(meta)}`);
    },
    error: (message, meta) => {
      api.logger.error(`${message}${serializeLogMeta(meta)}`);
    },
  };
}

function warnIfPromptHooksDisabled(api: OpenClawPluginApi): void {
  const pluginEntry = ((
    api.config as {
      plugins?: {
        entries?: Record<string, { hooks?: { allowPromptInjection?: boolean } }>;
      };
    }
  ).plugins?.entries ?? {})[CLAW_AEGIS_PLUGIN_ID];
  if (pluginEntry?.hooks?.allowPromptInjection === false) {
    api.logger.warn(
      '安全插件配置中已关闭提示词注入 hook，提示防护将不会运行',
    );
  }
}

function arePromptHooksEnabled(api: OpenClawPluginApi): boolean {
  const pluginEntry = ((
    api.config as {
      plugins?: {
        entries?: Record<string, { hooks?: { allowPromptInjection?: boolean } }>;
      };
    }
  ).plugins?.entries ?? {})[CLAW_AEGIS_PLUGIN_ID];
  return pluginEntry?.hooks?.allowPromptInjection !== false;
}

type DefenseLogMeta = {
  hook: string;
  mechanism: string;
  sessionKey?: string;
  runId?: string;
  toolName?: string;
  durationMs?: number;
  result?: string;
  [key: string]: unknown;
};

function logDefenseStart(logger: AegisLogger, meta: DefenseLogMeta): void {
  logger.info("claw-aegis: 开始执行防御检查", {
    event: "defense_check_started",
    ...meta,
  });
}

function logDefenseFinish(logger: AegisLogger, meta: DefenseLogMeta): void {
  logger.info("claw-aegis: 防御检查结束", {
    event: "defense_check_finished",
    ...meta,
  });
}

function logDefenseResult(
  logger: AegisLogger,
  meta: DefenseLogMeta,
  level: "info" | "warn" = "info",
): void {
  const message = "claw-aegis: 防御检查结果";
  const payload = {
    event: "defense_check_result",
    ...meta,
  };
  if (level === "warn") {
    logger.warn(message, payload);
    return;
  }
  logger.info(message, payload);
}

function mergeDefenseModes(...modes: DefenseMode[]): DefenseMode {
  if (modes.includes("enforce")) {
    return "enforce";
  }
  if (modes.includes("observe")) {
    return "observe";
  }
  return "off";
}

function resolveToolCallDefenseMode(
  modes: ToolCallDefenseModes,
  source: ToolCallDefenseModeSource | readonly ToolCallDefenseModeSource[],
): DefenseMode {
  const sources = Array.isArray(source) ? source : [source];
  return mergeDefenseModes(...sources.map((entry) => modes[entry]));
}

function isDefenseEnabled(mode: DefenseMode): boolean {
  return mode !== "off";
}

function logObservedToolCall(params: {
  logger: AegisLogger;
  mechanism: string;
  message: string;
  sessionKey?: string;
  runId?: string;
  toolName: string;
  reason: string;
  durationMs: number;
  extra?: Record<string, unknown>;
}): void {
  params.logger.warn(params.message, {
    event: "tool_call_observed",
    hook: "before_tool_call",
    mechanism: params.mechanism,
    toolName: params.toolName,
    sessionKey: params.sessionKey,
    runId: params.runId,
    reason: params.reason,
    mode: "observe",
    durationMs: params.durationMs,
    ...(params.extra ?? {}),
  });
}

export function createClawAegisRuntime(
  api: OpenClawPluginApi,
  options?: {
    now?: () => number;
    scanRunner?: (
      request: import("./types.js").SkillScanRequest,
    ) => Promise<import("./types.js").SkillScanResult>;
    toolCallDefenseStrategies?: readonly ToolCallDefenseStrategy[];
  },
) {
  const logger = createAegisLogger(api);
  const now = options?.now ?? Date.now;
  const stateDir = resolveClawAegisStateDir(api);
  const config = resolveClawAegisPluginConfig(api);
  const skillScanRoots = resolveSkillScanRoots(api);
  const state = new ClawAegisState({ stateDir, logger, now: options?.now });
  const scanService = new SkillScanService({
    state,
    logger,
    now: options?.now,
    runner: options?.scanRunner,
  });
  const toolCallDefenseStrategies =
    options?.toolCallDefenseStrategies ?? TOOL_CALL_DEFENSE_STRATEGIES;
  const staticSystemContext = config.promptGuardEnabled
    ? buildStaticSystemContext({ selfProtectionEnabled: config.selfProtectionEnabled })
    : undefined;
  const promptHooksEnabled = arePromptHooksEnabled(api);

  warnIfPromptHooksDisabled(api);

  return {
    state,
    scanService,
    hooks: {
      gateway_start: async () => {
        logger.info("claw-aegis: 网关启动", {
          event: "gateway_start",
        });

        try {
          await state.loadPersistentState();
          logger.info("claw-aegis: 已恢复持久化状态", {
            event: "state_restored",
          });
        } catch (error) {
          logger.error("claw-aegis: 恢复持久化状态失败", {
            event: "state_restore_failed",
            reason: error instanceof Error ? error.message : String(error),
          });
        }

        try {
          const protectedRoots = config.selfProtectionEnabled
            ? await resolveProtectedRoots(api, stateDir)
            : [];
          state.setProtectedRoots(protectedRoots);
          logger.info("claw-aegis: 已解析受保护路径", {
            event: "protected_roots_ready",
            count: protectedRoots.length,
            enabled: config.selfProtectionEnabled,
          });
        } catch (error) {
          logger.error("claw-aegis: 解析受保护路径失败", {
            event: "protected_roots_failed",
            reason: error instanceof Error ? error.message : String(error),
          });
        }

        if (config.selfProtectionEnabled) {
          try {
            const integrityRecord = await buildSelfIntegrityRecord({
              api,
              stateDir,
              protectedRoots: state.getProtectedRoots(),
            });
            state.setSelfIntegrityRecord(integrityRecord);
            await state.persistSelfIntegrity();
            logger.info("claw-aegis: 已刷新自完整性记录", {
              event: "self_integrity_refreshed",
            });
          } catch (error) {
            logger.error("claw-aegis: 刷新自完整性记录失败", {
              event: "self_integrity_failed",
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }

        try {
          if (!config.skillScanEnabled) {
            logger.info("claw-aegis: 配置已关闭 skill 扫描", {
              event: "skill_scan_disabled",
            });
            return;
          }
          if (config.skillRoots.length > 0) {
            logger.warn("claw-aegis: 已忽略过时的 skillRoots 配置", {
              event: "skill_scan_legacy_roots_ignored",
              ignoredCount: config.skillRoots.length,
            });
          }
          scanService.start();
          if (config.startupSkillScan) {
            void scanService
              .scanRoots({ roots: skillScanRoots, budgetMs: STARTUP_SCAN_BUDGET_MS })
              .catch((error) => {
                logger.warn("claw-aegis: 启动阶段的 skill 扫描已降级", {
                  event: "startup_skill_scan_failed",
                  reason: error instanceof Error ? error.message : String(error),
                });
              });
          }
        } catch (error) {
          logger.error("claw-aegis: 启动 skill 扫描服务失败", {
            event: "skill_scan_start_failed",
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      },

      message_received: (event: { content: string }, ctx: { sessionKey?: string }) => {
        const startedAt = now();
        const sessionKey = ctx.sessionKey?.trim();
        logDefenseStart(logger, {
          hook: "message_received",
          mechanism: "user_risk_scan",
          sessionKey,
        });
        if (!config.userRiskScanEnabled) {
          const durationMs = now() - startedAt;
          logDefenseResult(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            sessionKey,
            result: "disabled",
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            sessionKey,
            result: "disabled",
            durationMs,
          });
          return;
        }
        if (!sessionKey) {
          const durationMs = now() - startedAt;
          logDefenseResult(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            result: "skipped_missing_session",
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            result: "skipped_missing_session",
            durationMs,
          });
          return;
        }
        const match = detectUserRiskFlags(event.content ?? "");
        const durationMs = now() - startedAt;
        if (match.flags.length === 0) {
          logDefenseResult(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            sessionKey,
            result: "clear",
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            sessionKey,
            result: "clear",
            durationMs,
          });
          return;
        }
        state.noteUserRisk(sessionKey, match.flags);
        logger.warn("claw-aegis: 检测到用户风险请求", {
          event: "user_risk_detected",
          hook: "message_received",
          sessionKey,
          flags: match.flags,
        });
        logDefenseResult(logger, {
          hook: "message_received",
          mechanism: "user_risk_scan",
          sessionKey,
          result: "risk_detected",
          durationMs,
          flagCount: match.flags.length,
        }, "warn");
        logDefenseFinish(logger, {
          hook: "message_received",
          mechanism: "user_risk_scan",
          sessionKey,
          result: "risk_detected",
          durationMs,
          flagCount: match.flags.length,
        });
      },

      message_sending: (
        event: PluginHookMessageSendingEvent,
        ctx: { sessionKey?: string },
      ): PluginHookMessageSendingResult | undefined => {
        const startedAt = now();
        const sessionKey = ctx.sessionKey?.trim();
        logDefenseStart(logger, {
          hook: "message_sending",
          mechanism: "output_redaction",
          sessionKey,
        });
        if (!config.outputRedactionEnabled) {
          const durationMs = now() - startedAt;
          logDefenseResult(logger, {
            hook: "message_sending",
            mechanism: "output_redaction",
            sessionKey,
            result: "disabled",
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "message_sending",
            mechanism: "output_redaction",
            sessionKey,
            result: "disabled",
            durationMs,
          });
          return undefined;
        }

        const observedSecrets = sessionKey ? state.peekObservedSecrets(sessionKey) : [];
        const sanitized = sanitizeSensitiveOutputText(event.content, { observedSecrets });
        const durationMs = now() - startedAt;
        if (sanitized.changed) {
          logger.warn("claw-aegis: 已脱敏对外发送消息中的敏感内容", {
            event: "outbound_message_redacted",
            hook: "message_sending",
            sessionKey,
            to: event.to,
            redactionCount: sanitized.redactionCount,
            matchedKeywords: sanitized.matchedKeywords,
            durationMs,
          });
        }
        logDefenseResult(logger, {
          hook: "message_sending",
          mechanism: "output_redaction",
          sessionKey,
          result: sanitized.changed ? "redacted" : "clear",
          durationMs,
          redactionCount: sanitized.redactionCount,
        });
        logDefenseFinish(logger, {
          hook: "message_sending",
          mechanism: "output_redaction",
          sessionKey,
          result: sanitized.changed ? "redacted" : "clear",
          durationMs,
          redactionCount: sanitized.redactionCount,
        });
        return sanitized.changed ? { content: sanitized.value } : undefined;
      },

      before_prompt_build: async (
        event: PluginHookBeforePromptBuildEvent,
        ctx: {
          sessionKey?: string;
        },
      ): Promise<PluginHookBeforePromptBuildResult | undefined> => {
        const startedAt = now();
        const sessionKey = ctx.sessionKey?.trim();
        let syntheticState: TurnSecurityState | undefined;
        const prompt = typeof event.prompt === "string" ? event.prompt : undefined;
        if (sessionKey && prompt?.trim()) {
          state.notePromptSnapshot(sessionKey, prompt);
        }
        logDefenseStart(logger, {
          hook: "before_prompt_build",
          mechanism: "prompt_guard",
          sessionKey,
        });
        if (!config.promptGuardEnabled || !promptHooksEnabled) {
          const result = !config.promptGuardEnabled ? "disabled" : "prompt_hooks_disabled";
          const durationMs = now() - startedAt;
          logDefenseResult(logger, {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result,
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result,
            durationMs,
          });
          return undefined;
        }
        if (config.skillScanEnabled) {
          try {
            const skillReview = await scanService.inspectTurnSkillRisks({ roots: skillScanRoots });
            if (skillReview.riskyAssessments.length > 0) {
              const skillRiskFlags = [
                ...new Set(
                  skillReview.riskyAssessments.flatMap((assessment) => assessment.findings),
                ),
              ];
              const riskySkills = [
                ...new Set(skillReview.riskyAssessments.map((assessment) => assessment.skillId)),
              ];
              logger.warn("claw-aegis: 已将高风险 skill 提升为提示防护", {
                event: "skill_prompt_guard_triggered",
                hook: "before_prompt_build",
                sessionKey,
                riskySkillCount: riskySkills.length,
                riskySkills,
                skillRiskFlags,
                reviewedCount: skillReview.reviewedCount,
                rescannedCount: skillReview.rescannedCount,
                reusedCount: skillReview.reusedCount,
              });
              if (sessionKey) {
                state.noteSkillRisk(sessionKey, {
                  flags: skillRiskFlags,
                  skillIds: riskySkills,
                });
              } else {
                syntheticState = createSyntheticSkillRiskState({
                  now: now(),
                  skillRiskFlags,
                  riskySkills,
                });
              }
            }
          } catch (error) {
            logger.error("claw-aegis: 本轮 skill 风险复核失败", {
              event: "skill_prompt_guard_failed",
              hook: "before_prompt_build",
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
        const currentState = sessionKey ? state.consumePromptState(sessionKey) : syntheticState;
        const dynamicPromptContext = buildDynamicPromptContext(currentState);
        const prependSystemContext = joinPresentTextSegments([
          staticSystemContext,
          dynamicPromptContext,
        ]);
        const durationMs = now() - startedAt;
        if (currentState?.prependNeeded) {
          logger.info("claw-aegis: 已注入提示防护", {
            event: "prompt_safeguards_injected",
            hook: "before_prompt_build",
            sessionKey,
            userRiskFlags: currentState.userRiskFlags.length,
            toolResultFlags: currentState.toolResultRiskFlags.length,
            toolResultSuspicious: currentState.toolResultSuspicious,
            skillRiskFlags: currentState.skillRiskFlags.length,
            riskySkills: currentState.riskySkills.length,
          });
        }
        if (!prependSystemContext) {
          logDefenseResult(logger, {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result: "no_context_injected",
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result: "no_context_injected",
            durationMs,
          });
          return undefined;
        }
        const promptGuardResult =
          staticSystemContext && dynamicPromptContext
            ? "static_and_dynamic_injected"
            : staticSystemContext
              ? "static_only_injected"
              : "dynamic_only_injected";
        logDefenseResult(
          logger,
          {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result: promptGuardResult,
            durationMs,
            userRiskFlags: currentState?.userRiskFlags.length ?? 0,
            toolResultFlags: currentState?.toolResultRiskFlags.length ?? 0,
            skillRiskFlags: currentState?.skillRiskFlags.length ?? 0,
            riskySkills: currentState?.riskySkills.length ?? 0,
          },
          "info",
        );
        logDefenseFinish(logger, {
          hook: "before_prompt_build",
          mechanism: "prompt_guard",
          sessionKey,
          result: promptGuardResult,
          durationMs,
        });
        return {
          prependSystemContext,
        };
      },

      before_tool_call: (
        event: PluginHookBeforeToolCallEvent,
        ctx: {
          sessionKey?: string;
          runId?: string;
        },
      ): PluginHookBeforeToolCallResult | undefined => {
        const normalizedToolName = normalizeToolName(event.toolName);
        const normalizedParams = normalizeToolParamsForGuard(event.params ?? {});
        const sessionKey = ctx.sessionKey?.trim();
        const runId = ctx.runId?.trim();
        const selfProtectionMode = config.selfProtectionMode;
        const commandBlockMode = config.commandBlockMode;
        const encodingGuardMode = config.encodingGuardMode;
        const scriptProvenanceGuardMode = config.scriptProvenanceGuardMode;
        const memoryGuardMode = config.memoryGuardMode;
        const loopGuardMode = config.loopGuardMode;
        const exfiltrationGuardMode = config.exfiltrationGuardMode;
        const toolCallModes: ToolCallDefenseModes = {
          selfProtection: selfProtectionMode,
          commandBlock: commandBlockMode,
          encodingGuard: encodingGuardMode,
          commandObfuscation: mergeDefenseModes(commandBlockMode, encodingGuardMode),
          scriptProvenanceGuard: scriptProvenanceGuardMode,
          memoryGuard: memoryGuardMode,
          loopGuard: loopGuardMode,
          exfiltrationGuard: exfiltrationGuardMode,
        };
        const toolGuardStartedAt = now();
        logDefenseStart(logger, {
          hook: "before_tool_call",
          mechanism: "tool_call_guard",
          sessionKey,
          runId,
          toolName: normalizedToolName,
        });
        const hasAnyEnabledStrategy = toolCallDefenseStrategies.some((strategy) =>
          isDefenseEnabled(resolveToolCallDefenseMode(toolCallModes, strategy.modeSource)),
        );
        if (!hasAnyEnabledStrategy) {
          const durationMs = now() - toolGuardStartedAt;
          logDefenseResult(logger, {
            hook: "before_tool_call",
            mechanism: "tool_call_guard",
            sessionKey,
            runId,
            toolName: normalizedToolName,
            result: "disabled",
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "before_tool_call",
            mechanism: "tool_call_guard",
            sessionKey,
            runId,
            toolName: normalizedToolName,
            result: "disabled",
            durationMs,
          });
          return undefined;
        }
        const baseDir = process.cwd();
        const protectedRoots = isDefenseEnabled(selfProtectionMode) ? state.getProtectedRoots() : [];
        const pathCandidates = resolveProtectedPathCandidates(
          normalizedToolName,
          normalizedParams,
          baseDir,
        );

        logger.debug?.("claw-aegis: 已规范化工具调用", {
          event: "tool_call_normalized",
          hook: "before_tool_call",
          sessionKey,
          runId,
          toolName: normalizedToolName,
          candidateCount: pathCandidates.length,
        });

        const previousToolCalls = runId ? state.peekRunToolCalls(runId) : [];
        const observedSecrets = sessionKey ? state.peekObservedSecrets(sessionKey) : [];
        const fingerprintTimestamp = now();
        if (runId && observedSecrets.length > 0) {
          state.noteRunSecretFingerprints(runId, {
            sessionKey,
            fingerprints: buildSecretFingerprints(
              observedSecrets,
              "observed-secret",
              fingerprintTimestamp,
            ),
          });
        }
        const runSecurityState = runId ? state.peekRunSecurityState(runId) : undefined;
        const promptSnapshot = sessionKey ? state.peekPromptSnapshot(sessionKey) : undefined;
        const commandText = readCommandText(normalizedParams);
        const toolCallContext: ToolCallDefenseContext = {
          toolName: normalizedToolName,
          params: normalizedParams,
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
          protectedSkills: config.protectedSkills,
          protectedPlugins: config.protectedPlugins,
          now,
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
            incrementLoopCounter: (nextSessionKey, nextRunId, stableArgsKey) =>
              state.incrementLoopCounter(nextSessionKey, nextRunId, stableArgsKey),
            noteRunSecuritySignals: (nextRunId, payload) =>
              state.noteRunSecuritySignals(nextRunId, payload),
            noteRuntimeRisk: (nextSessionKey, flags) =>
              state.noteRuntimeRisk(nextSessionKey, flags),
            noteRunToolCall: (nextRunId, record) =>
              state.noteRunToolCall(nextRunId, record),
          },
        };

        for (const strategy of toolCallDefenseStrategies) {
          if (!strategy.appliesTo(toolCallContext)) {
            continue;
          }

          const startedAt = now();
          logDefenseStart(logger, {
            hook: "before_tool_call",
            mechanism: strategy.id,
            sessionKey,
            runId,
            toolName: normalizedToolName,
          });
          const evaluation: ToolCallDefenseEvaluation = strategy.evaluate(toolCallContext);
          const durationMs = now() - startedAt;
          const resultMeta = {
            hook: "before_tool_call",
            mechanism: strategy.id,
            sessionKey,
            runId,
            toolName: normalizedToolName,
            result: evaluation.result,
            durationMs,
            ...(evaluation.extra ?? {}),
          };

          if (evaluation.result === "blocked") {
            logger.warn(strategy.blockedMessage ?? "claw-aegis: 已阻止风险工具调用", {
              event: "tool_call_blocked",
              hook: "before_tool_call",
              toolName: normalizedToolName,
              sessionKey,
              runId,
              reason: evaluation.reason,
              ...(evaluation.extra ?? {}),
            });
            logDefenseFinish(logger, resultMeta);
            const totalDurationMs = now() - toolGuardStartedAt;
            logDefenseFinish(logger, {
              hook: "before_tool_call",
              mechanism: "tool_call_guard",
              sessionKey,
              runId,
              toolName: normalizedToolName,
              result: "blocked",
              durationMs: totalDurationMs,
              blockedBy: strategy.id,
            });
            return {
              block: true,
              blockReason: evaluation.reason,
            };
          }

          if (evaluation.result === "observed") {
            logObservedToolCall({
              logger,
              mechanism: strategy.id,
              message: strategy.observedMessage ?? "claw-aegis: 观察者模式命中风险工具调用，已放行",
              sessionKey,
              runId,
              toolName: normalizedToolName,
              reason: evaluation.reason ?? "unknown",
              durationMs,
              extra: evaluation.extra,
            });
            if (evaluation.emitResultLog) {
              logDefenseResult(logger, resultMeta, evaluation.level ?? "warn");
            }
            logDefenseFinish(logger, resultMeta);
            continue;
          }

          logDefenseResult(logger, resultMeta, evaluation.level ?? "info");
          logDefenseFinish(logger, resultMeta);
        }

        if (runId) {
          state.noteRunToolCall(runId, {
            runId,
            sessionKey,
            toolName: normalizedToolName,
            params: normalizedParams,
            timestamp: now(),
          });
        }

        const totalDurationMs = now() - toolGuardStartedAt;
        logDefenseResult(logger, {
          hook: "before_tool_call",
          mechanism: "tool_call_guard",
          sessionKey,
          runId,
          toolName: normalizedToolName,
          result: "allowed",
          durationMs: totalDurationMs,
        });
        logDefenseFinish(logger, {
          hook: "before_tool_call",
          mechanism: "tool_call_guard",
          sessionKey,
          runId,
          toolName: normalizedToolName,
          result: "allowed",
          durationMs: totalDurationMs,
        });
        return undefined;
      },

      after_tool_call: (
        event: PluginHookAfterToolCallEvent,
        ctx: {
          sessionKey?: string;
          runId?: string;
        },
      ) => {
        const sessionKey = ctx.sessionKey?.trim();
        const runId = ctx.runId?.trim();
        const normalizedToolName = normalizeToolName(event.toolName);
        const normalizedParams = normalizeToolParamsForGuard(event.params ?? {});
        if (!runId) {
          return;
        }
        if (!event.error && config.scriptProvenanceGuardEnabled) {
          const artifacts = collectScriptArtifactRecords(normalizedToolName, normalizedParams, {
            runId,
            sessionKey,
            timestamp: now(),
            baseDir: process.cwd(),
          });
          if (artifacts.length > 0) {
            state.noteRunScriptArtifacts(runId, {
              sessionKey,
              artifacts,
            });
            const derivedSignals = deriveScriptArtifactSignals(artifacts);
            state.noteRunSecuritySignals(runId, {
              sessionKey,
              sourceSignals: derivedSignals.sourceSignals,
              transformSignals: derivedSignals.transformSignals,
              sinkSignals: derivedSignals.sinkSignals,
              runtimeRiskFlags: derivedSignals.runtimeRiskFlags,
            });
            if (sessionKey && derivedSignals.runtimeRiskFlags.length > 0) {
              state.noteRuntimeRisk(sessionKey, derivedSignals.runtimeRiskFlags);
            }
            logger.info("claw-aegis: 已记录本轮新产生的脚本产物", {
              event: "script_artifacts_recorded",
              hook: "after_tool_call",
              sessionKey,
              runId,
              toolName: normalizedToolName,
              artifactCount: artifacts.length,
            });
          }
        }
        const calls = state.peekRunToolCalls(runId);
        if (calls.length === 0) {
          return;
        }
        const blockedCount = calls.filter((call) => call.blocked).length;
        logger.info("claw-aegis: 已更新同 run 工具调用链", {
          event: "tool_call_chain_updated",
          hook: "after_tool_call",
          sessionKey,
          runId,
          totalCalls: calls.length,
          blockedCalls: blockedCount,
        });
      },

      agent_end: (
        _event: PluginHookAgentEndEvent,
        ctx: {
          sessionKey?: string;
          runId?: string;
        },
      ) => {
        const sessionKey = ctx.sessionKey?.trim();
        const runId = ctx.runId?.trim();
        if (runId) {
          state.clearRunToolCalls(runId);
          state.clearRunSecurityState(runId);
        }
        if (sessionKey) {
          state.clearSessionRuntimeState(sessionKey);
        }
        if (runId || sessionKey) {
          logger.info("claw-aegis: 已清理本轮临时安全状态", {
            event: "agent_runtime_state_cleared",
            hook: "agent_end",
            sessionKey,
            runId,
          });
        }
      },

      session_end: (
        _event: PluginHookSessionEndEvent,
        ctx: {
          sessionKey?: string;
        },
      ) => {
        const sessionKey = ctx.sessionKey?.trim();
        if (!sessionKey) {
          return;
        }
        state.clearSessionRuntimeState(sessionKey);
        logger.info("claw-aegis: 已清理 session 级临时安全状态", {
          event: "session_runtime_state_cleared",
          hook: "session_end",
          sessionKey,
        });
      },

      before_message_write: (
        event: PluginHookBeforeMessageWriteEvent,
        ctx: { sessionKey?: string },
      ) => {
        const startedAt = now();
        const sessionKey = ctx.sessionKey?.trim();
        const message = event.message as Record<string, unknown>;

        if (message.role === "assistant") {
          logDefenseStart(logger, {
            hook: "before_message_write",
            mechanism: "output_redaction",
            sessionKey,
          });
          if (!config.outputRedactionEnabled) {
            const durationMs = now() - startedAt;
            logDefenseResult(logger, {
              hook: "before_message_write",
              mechanism: "output_redaction",
              sessionKey,
              result: "disabled",
              durationMs,
            });
            logDefenseFinish(logger, {
              hook: "before_message_write",
              mechanism: "output_redaction",
              sessionKey,
              result: "disabled",
              durationMs,
            });
            return undefined;
          }

          const observedSecrets = sessionKey ? state.peekObservedSecrets(sessionKey) : [];
          const sanitized = sanitizeAssistantMessage(message, { observedSecrets });
          const durationMs = now() - startedAt;
          if (sanitized.changed) {
            logger.warn("claw-aegis: 已脱敏 assistant 输出中的敏感内容", {
              event: "assistant_output_redacted",
              hook: "before_message_write",
              sessionKey,
              redactionCount: sanitized.redactionCount,
              matchedKeywords: sanitized.matchedKeywords,
              durationMs,
            });
          }
          logDefenseResult(logger, {
            hook: "before_message_write",
            mechanism: "output_redaction",
            sessionKey,
            result: sanitized.changed ? "redacted" : "clear",
            durationMs,
            redactionCount: sanitized.redactionCount,
          });
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "output_redaction",
            sessionKey,
            result: sanitized.changed ? "redacted" : "clear",
            durationMs,
            redactionCount: sanitized.redactionCount,
          });
          return sanitized.changed ? { message: sanitized.message as never } : undefined;
        }

        logDefenseStart(logger, {
          hook: "before_message_write",
          mechanism: "tool_result_scan",
          sessionKey,
        });

        if (!config.toolResultScanEnabled) {
          const durationMs = now() - startedAt;
          logDefenseResult(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: "disabled",
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: "disabled",
            durationMs,
          });
          return undefined;
        }

        if (!sessionKey || message.role !== "toolResult") {
          const durationMs = now() - startedAt;
          logDefenseResult(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: !sessionKey ? "skipped_missing_session" : "skipped_non_tool_result",
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: !sessionKey ? "skipped_missing_session" : "skipped_non_tool_result",
            durationMs,
          });
          return undefined;
        }
        try {
          const thirdPartyWebContent = isThirdPartyWebToolResultMessage(message);
          const toolName = typeof message.toolName === "string" ? message.toolName : undefined;
          const rawExtracted = thirdPartyWebContent
            ? collectToolResultScanText(message as never)
            : undefined;
          if (thirdPartyWebContent) {
            logger.info("claw-aegis: 开始处理第三方网页内容", {
              event: "third_party_web_content_processing_started",
              hook: "before_message_write",
              sessionKey,
              toolName,
              contentCharsBefore: rawExtracted?.text.length ?? 0,
              oversizeBefore: rawExtracted?.oversize ?? false,
            });
          }
          const sanitized = sanitizeToolResultMessage(message);
          const extracted = collectToolResultScanText(sanitized.message as never);
          const observedSecrets = collectSensitiveOutputValues(extracted.text);
          if (observedSecrets.length > 0) {
            state.noteObservedSecrets(sessionKey, observedSecrets);
          }
          if (thirdPartyWebContent || sanitized.externalContent) {
            logger.info("claw-aegis: 完成处理第三方网页内容", {
              event: "third_party_web_content_processing_finished",
              hook: "before_message_write",
              sessionKey,
              toolName,
              contentCharsBefore: rawExtracted?.text.length ?? 0,
              contentCharsAfter: extracted.text.length,
              oversizeBefore: rawExtracted?.oversize ?? false,
              oversizeAfter: extracted.oversize,
              specialTokensRemoved: sanitized.removedTokenCount,
              markerInjected: sanitized.markerInjected,
              rewritten: sanitized.changed,
            });
          }
          const outcome = scanToolResultText(extracted.text, extracted.oversize);
          state.noteToolResult(sessionKey, outcome);
          const encodedRiskFlags = outcome.riskFlags.filter((flag) => flag.startsWith("encoded-"));
          if (encodedRiskFlags.length > 0) {
            state.noteRuntimeRisk(sessionKey, encodedRiskFlags);
          }
          const durationMs = now() - startedAt;
          const logMeta = {
            event: "tool_result_reviewed",
            hook: "before_message_write",
            sessionKey,
            suspicious: outcome.suspicious,
            oversize: outcome.oversize,
            flags: outcome.riskFlags,
            externalContent: sanitized.externalContent,
            specialTokensRemoved: sanitized.removedTokenCount,
            markerInjected: sanitized.markerInjected,
            rewritten: sanitized.changed,
            durationMs,
          };
          if (
            outcome.suspicious ||
            outcome.oversize ||
            outcome.riskFlags.length > 0 ||
            sanitized.removedTokenCount > 0
          ) {
            logger.warn("claw-aegis: 已完成工具结果审查", logMeta);
          } else {
            logger.debug?.("claw-aegis: 已完成工具结果审查", logMeta);
          }
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result:
              outcome.suspicious ||
              outcome.oversize ||
              outcome.riskFlags.length > 0 ||
              sanitized.removedTokenCount > 0
                ? "risk_detected"
                : "clear",
            durationMs,
            flagCount: outcome.riskFlags.length,
            specialTokensRemoved: sanitized.removedTokenCount,
            markerInjected: sanitized.markerInjected,
          });
          return sanitized.changed ? { message: sanitized.message as never } : undefined;
        } catch (error) {
          state.markToolResultSeen(sessionKey);
          const durationMs = now() - startedAt;
          logger.error("claw-aegis: 工具结果扫描已降级", {
            event: "tool_result_scan_failed",
            hook: "before_message_write",
            sessionKey,
            reason: error instanceof Error ? error.message : String(error),
            durationMs,
          });
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: "degraded",
            durationMs,
          });
        }
        return undefined;
      },
    },
  };
}
