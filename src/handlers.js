import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CLAW_AEGIS_PLUGIN_ID,
  DEFENSE_EVENTS_FILENAME,
  SKILL_SCAN_EVENTS_FILENAME,
  STARTUP_SCAN_BUDGET_MS
} from "./config.js";
import {
  resolveClawAegisPluginConfig,
  resolveClawAegisStateDir,
  resolveSkillScanRoots
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
  scanToolResultText
} from "./rules.js";
import {
  TOOL_CALL_DEFENSE_STRATEGIES
} from "./security-strategies.js";
import { SkillScanService } from "./scan-service.js";
import { ClawAegisState } from "./state.js";
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
  "src/handlers.ts"
];
function joinPresentTextSegments(segments) {
  const values = segments.map((segment) => segment?.trim()).filter(Boolean);
  return values.length > 0 ? values.join("\n\n") : void 0;
}
function readCommandText(params) {
  for (const key of ["command", "cmd"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return void 0;
}
function buildSecretFingerprints(values, source, timestamp) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].filter((value) => value.length >= 8).map((value) => ({
    hash: createHash("sha256").update(value).digest("hex"),
    length: value.length,
    source,
    updatedAt: timestamp
  }));
}
function deriveScriptArtifactSignals(artifacts) {
  const sourceSignals = /* @__PURE__ */ new Set();
  const transformSignals = /* @__PURE__ */ new Set();
  const sinkSignals = /* @__PURE__ */ new Set();
  const runtimeRiskFlags = /* @__PURE__ */ new Set();
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
    runtimeRiskFlags: [...runtimeRiskFlags]
  };
}
async function resolveRealPath(input) {
  if (!input?.trim()) {
    return void 0;
  }
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
}
async function resolveProtectedRoots(api, stateDir) {
  const config = resolveClawAegisPluginConfig(api);
  const stateRoot = path.resolve(api.runtime.state.resolveStateDir());
  const candidates = /* @__PURE__ */ new Set();
  const append = async (entry) => {
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
async function buildSelfIntegrityRecord(params) {
  const rootDir = params.api.rootDir ? path.resolve(params.api.rootDir) : void 0;
  const rootRealPath = await resolveRealPath(rootDir);
  const fingerprints = {};
  if (rootDir) {
    for (const relativePath of SELF_INTEGRITY_FILES) {
      const absolutePath = path.join(rootDir, relativePath);
      try {
        const content = await fs.readFile(absolutePath);
        fingerprints[relativePath] = createHash("sha256").update(content).digest("hex").slice(0, 16);
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
    updatedAt: Date.now()
  };
}
function createSyntheticSkillRiskState(params) {
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
    updatedAt: params.now
  };
}
function serializeLogMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' {"meta":"[unserializable]"}';
  }
}
function createAegisLogger(api) {
  return {
    debug: api.logger.debug ? (message, meta) => {
      api.logger.debug?.(`${message}${serializeLogMeta(meta)}`);
    } : void 0,
    info: (message, meta) => {
      api.logger.info(`${message}${serializeLogMeta(meta)}`);
    },
    warn: (message, meta) => {
      api.logger.warn(`${message}${serializeLogMeta(meta)}`);
    },
    error: (message, meta) => {
      api.logger.error(`${message}${serializeLogMeta(meta)}`);
    }
  };
}
function warnIfPromptHooksDisabled(api) {
  const pluginEntry = (api.config.plugins?.entries ?? {})[CLAW_AEGIS_PLUGIN_ID];
  if (pluginEntry?.hooks?.allowPromptInjection === false) {
    api.logger.warn(
      "\u5B89\u5168\u63D2\u4EF6\u914D\u7F6E\u4E2D\u5DF2\u5173\u95ED\u63D0\u793A\u8BCD\u6CE8\u5165 hook\uFF0C\u63D0\u793A\u9632\u62A4\u5C06\u4E0D\u4F1A\u8FD0\u884C"
    );
  }
}
function arePromptHooksEnabled(api) {
  const pluginEntry = (api.config.plugins?.entries ?? {})[CLAW_AEGIS_PLUGIN_ID];
  return pluginEntry?.hooks?.allowPromptInjection !== false;
}
function logDefenseStart(logger, meta) {
  logger.info("claw-aegis: \u5F00\u59CB\u6267\u884C\u9632\u5FA1\u68C0\u67E5", {
    event: "defense_check_started",
    ...meta
  });
}
function logDefenseFinish(logger, meta) {
  logger.info("claw-aegis: \u9632\u5FA1\u68C0\u67E5\u7ED3\u675F", {
    event: "defense_check_finished",
    ...meta
  });
}
function logDefenseResult(logger, meta, level = "info") {
  const message = "claw-aegis: \u9632\u5FA1\u68C0\u67E5\u7ED3\u679C";
  const payload = {
    event: "defense_check_result",
    ...meta
  };
  if (level === "warn") {
    logger.warn(message, payload);
    return;
  }
  logger.info(message, payload);
}
function mergeDefenseModes(...modes) {
  if (modes.includes("enforce")) {
    return "enforce";
  }
  if (modes.includes("observe")) {
    return "observe";
  }
  return "off";
}
function resolveToolCallDefenseMode(modes, source) {
  const sources = Array.isArray(source) ? source : [source];
  return mergeDefenseModes(...sources.map((entry) => modes[entry]));
}
function isDefenseEnabled(mode) {
  return mode !== "off";
}
function createDefenseEventWriter(stateDir) {
  const eventsPath = path.join(stateDir, DEFENSE_EVENTS_FILENAME);
  let ensured = false;
  return (record) => {
    const line = JSON.stringify(record) + "\n";
    const doWrite = async () => {
      if (!ensured) {
        await fs.mkdir(stateDir, { recursive: true });
        ensured = true;
      }
      await fs.appendFile(eventsPath, line, "utf8");
    };
    doWrite().catch(() => {});
  };
}
function createSkillScanEventWriter(stateDir) {
  const eventsPath = path.join(stateDir, SKILL_SCAN_EVENTS_FILENAME);
  let ensured = false;
  return (record) => {
    const line = JSON.stringify(record) + "\n";
    const doWrite = async () => {
      if (!ensured) {
        await fs.mkdir(stateDir, { recursive: true });
        ensured = true;
      }
      await fs.appendFile(eventsPath, line, "utf8");
    };
    doWrite().catch(() => {});
  };
}
function logObservedToolCall(params) {
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
    ...params.extra ?? {}
  });
}
function createClawAegisRuntime(api, options) {
  const logger = createAegisLogger(api);
  const now = options?.now ?? Date.now;
  const stateDir = resolveClawAegisStateDir(api);
  const emitDefenseEvent = createDefenseEventWriter(stateDir);
  const config = resolveClawAegisPluginConfig(api);
  const skillScanRoots = resolveSkillScanRoots(api);
  const state = new ClawAegisState({ stateDir, logger, now: options?.now });
  const emitSkillScanEvent = createSkillScanEventWriter(stateDir);
  const scanService = new SkillScanService({
    state,
    logger,
    now: options?.now,
    runner: options?.scanRunner,
    onScanComplete: emitSkillScanEvent
  });
  const toolCallDefenseStrategies = options?.toolCallDefenseStrategies ?? TOOL_CALL_DEFENSE_STRATEGIES;
  const staticSystemContext = config.promptGuardEnabled ? buildStaticSystemContext({ selfProtectionEnabled: config.selfProtectionEnabled }) : void 0;
  const promptHooksEnabled = arePromptHooksEnabled(api);
  warnIfPromptHooksDisabled(api);
  return {
    state,
    scanService,
    hooks: {
      gateway_start: async () => {
        logger.info("claw-aegis: \u7F51\u5173\u542F\u52A8", {
          event: "gateway_start"
        });
        try {
          await state.loadPersistentState();
          logger.info("claw-aegis: \u5DF2\u6062\u590D\u6301\u4E45\u5316\u72B6\u6001", {
            event: "state_restored"
          });
        } catch (error) {
          logger.error("claw-aegis: \u6062\u590D\u6301\u4E45\u5316\u72B6\u6001\u5931\u8D25", {
            event: "state_restore_failed",
            reason: error instanceof Error ? error.message : String(error)
          });
        }
        try {
          const protectedRoots = config.selfProtectionEnabled ? await resolveProtectedRoots(api, stateDir) : [];
          state.setProtectedRoots(protectedRoots);
          logger.info("claw-aegis: \u5DF2\u89E3\u6790\u53D7\u4FDD\u62A4\u8DEF\u5F84", {
            event: "protected_roots_ready",
            count: protectedRoots.length,
            enabled: config.selfProtectionEnabled
          });
        } catch (error) {
          logger.error("claw-aegis: \u89E3\u6790\u53D7\u4FDD\u62A4\u8DEF\u5F84\u5931\u8D25", {
            event: "protected_roots_failed",
            reason: error instanceof Error ? error.message : String(error)
          });
        }
        if (config.selfProtectionEnabled) {
          try {
            const integrityRecord = await buildSelfIntegrityRecord({
              api,
              stateDir,
              protectedRoots: state.getProtectedRoots()
            });
            state.setSelfIntegrityRecord(integrityRecord);
            await state.persistSelfIntegrity();
            logger.info("claw-aegis: \u5DF2\u5237\u65B0\u81EA\u5B8C\u6574\u6027\u8BB0\u5F55", {
              event: "self_integrity_refreshed"
            });
          } catch (error) {
            logger.error("claw-aegis: \u5237\u65B0\u81EA\u5B8C\u6574\u6027\u8BB0\u5F55\u5931\u8D25", {
              event: "self_integrity_failed",
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
        try {
          if (!config.skillScanEnabled) {
            logger.info("claw-aegis: \u914D\u7F6E\u5DF2\u5173\u95ED skill \u626B\u63CF", {
              event: "skill_scan_disabled"
            });
            return;
          }
          if (config.skillRoots.length > 0) {
            logger.warn("claw-aegis: \u5DF2\u5FFD\u7565\u8FC7\u65F6\u7684 skillRoots \u914D\u7F6E", {
              event: "skill_scan_legacy_roots_ignored",
              ignoredCount: config.skillRoots.length
            });
          }
          scanService.start();
          if (config.startupSkillScan) {
            void scanService.scanRoots({ roots: skillScanRoots, budgetMs: STARTUP_SCAN_BUDGET_MS }).catch((error) => {
              logger.warn("claw-aegis: \u542F\u52A8\u9636\u6BB5\u7684 skill \u626B\u63CF\u5DF2\u964D\u7EA7", {
                event: "startup_skill_scan_failed",
                reason: error instanceof Error ? error.message : String(error)
              });
            });
          }
        } catch (error) {
          logger.error("claw-aegis: \u542F\u52A8 skill \u626B\u63CF\u670D\u52A1\u5931\u8D25", {
            event: "skill_scan_start_failed",
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      },
      message_received: (event, ctx) => {
        const startedAt = now();
        const sessionKey = ctx.sessionKey?.trim();
        if (sessionKey && event.content) {
          state.noteLastUserInput(sessionKey, event.content);
        }
        logDefenseStart(logger, {
          hook: "message_received",
          mechanism: "user_risk_scan",
          sessionKey
        });
        if (!config.userRiskScanEnabled) {
          const durationMs2 = now() - startedAt;
          logDefenseResult(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            sessionKey,
            result: "disabled",
            durationMs: durationMs2
          });
          logDefenseFinish(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            sessionKey,
            result: "disabled",
            durationMs: durationMs2
          });
          return;
        }
        if (!sessionKey) {
          const durationMs2 = now() - startedAt;
          logDefenseResult(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            result: "skipped_missing_session",
            durationMs: durationMs2
          });
          logDefenseFinish(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            result: "skipped_missing_session",
            durationMs: durationMs2
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
            durationMs
          });
          logDefenseFinish(logger, {
            hook: "message_received",
            mechanism: "user_risk_scan",
            sessionKey,
            result: "clear",
            durationMs
          });
          return;
        }
        state.noteUserRisk(sessionKey, match.flags);
        emitDefenseEvent({
          timestamp: now(),
          defense: "user_risk_scan",
          result: "observed",
          reason: `检测到风险标记: ${match.flags.join(", ")}`,
          details: { flags: match.flags },
          userInput: (event.content ?? "").slice(0, 500)
        });
        logger.warn("claw-aegis: \u68C0\u6D4B\u5230\u7528\u6237\u98CE\u9669\u8BF7\u6C42", {
          event: "user_risk_detected",
          hook: "message_received",
          sessionKey,
          flags: match.flags
        });
        logDefenseResult(logger, {
          hook: "message_received",
          mechanism: "user_risk_scan",
          sessionKey,
          result: "risk_detected",
          durationMs,
          flagCount: match.flags.length
        }, "warn");
        logDefenseFinish(logger, {
          hook: "message_received",
          mechanism: "user_risk_scan",
          sessionKey,
          result: "risk_detected",
          durationMs,
          flagCount: match.flags.length
        });
      },
      message_sending: (event, ctx) => {
        const startedAt = now();
        const sessionKey = ctx.sessionKey?.trim();
        logDefenseStart(logger, {
          hook: "message_sending",
          mechanism: "output_redaction",
          sessionKey
        });
        if (!config.outputRedactionEnabled) {
          const durationMs2 = now() - startedAt;
          logDefenseResult(logger, {
            hook: "message_sending",
            mechanism: "output_redaction",
            sessionKey,
            result: "disabled",
            durationMs: durationMs2
          });
          logDefenseFinish(logger, {
            hook: "message_sending",
            mechanism: "output_redaction",
            sessionKey,
            result: "disabled",
            durationMs: durationMs2
          });
          return void 0;
        }
        const observedSecrets = sessionKey ? state.peekObservedSecrets(sessionKey) : [];
        const sanitized = sanitizeSensitiveOutputText(event.content, { observedSecrets });
        const durationMs = now() - startedAt;
        if (sanitized.changed) {
          emitDefenseEvent({
            timestamp: now(),
            defense: "output_redaction",
            result: "observed",
            reason: `脱敏 ${sanitized.redactionCount} 处敏感内容`,
            details: { redactionCount: sanitized.redactionCount, matchedKeywords: sanitized.matchedKeywords },
          });
          logger.warn("claw-aegis: \u5DF2\u8131\u654F\u5BF9\u5916\u53D1\u9001\u6D88\u606F\u4E2D\u7684\u654F\u611F\u5185\u5BB9", {
            event: "outbound_message_redacted",
            hook: "message_sending",
            sessionKey,
            to: event.to,
            redactionCount: sanitized.redactionCount,
            matchedKeywords: sanitized.matchedKeywords,
            durationMs
          });
        }
        logDefenseResult(logger, {
          hook: "message_sending",
          mechanism: "output_redaction",
          sessionKey,
          result: sanitized.changed ? "redacted" : "clear",
          durationMs,
          redactionCount: sanitized.redactionCount
        });
        logDefenseFinish(logger, {
          hook: "message_sending",
          mechanism: "output_redaction",
          sessionKey,
          result: sanitized.changed ? "redacted" : "clear",
          durationMs,
          redactionCount: sanitized.redactionCount
        });
        return sanitized.changed ? { content: sanitized.value } : void 0;
      },
      before_prompt_build: async (event, ctx) => {
        const startedAt = now();
        const sessionKey = ctx.sessionKey?.trim();
        let syntheticState;
        const prompt = typeof event.prompt === "string" ? event.prompt : void 0;
        if (sessionKey && prompt?.trim()) {
          state.notePromptSnapshot(sessionKey, prompt);
        }
        logDefenseStart(logger, {
          hook: "before_prompt_build",
          mechanism: "prompt_guard",
          sessionKey
        });
        if (!config.promptGuardEnabled || !promptHooksEnabled) {
          const result = !config.promptGuardEnabled ? "disabled" : "prompt_hooks_disabled";
          const durationMs2 = now() - startedAt;
          logDefenseResult(logger, {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result,
            durationMs: durationMs2
          });
          logDefenseFinish(logger, {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result,
            durationMs: durationMs2
          });
          return void 0;
        }
        if (config.skillScanEnabled) {
          try {
            const skillReview = await scanService.inspectTurnSkillRisks({ roots: skillScanRoots });
            if (skillReview.riskyAssessments.length > 0) {
              const skillRiskFlags = [
                ...new Set(
                  skillReview.riskyAssessments.flatMap((assessment) => assessment.findings)
                )
              ];
              const riskySkills = [
                ...new Set(skillReview.riskyAssessments.map((assessment) => assessment.skillId))
              ];
              logger.warn("claw-aegis: \u5DF2\u5C06\u9AD8\u98CE\u9669 skill \u63D0\u5347\u4E3A\u63D0\u793A\u9632\u62A4", {
                event: "skill_prompt_guard_triggered",
                hook: "before_prompt_build",
                sessionKey,
                riskySkillCount: riskySkills.length,
                riskySkills,
                skillRiskFlags,
                reviewedCount: skillReview.reviewedCount,
                rescannedCount: skillReview.rescannedCount,
                reusedCount: skillReview.reusedCount
              });
              if (sessionKey) {
                state.noteSkillRisk(sessionKey, {
                  flags: skillRiskFlags,
                  skillIds: riskySkills
                });
              } else {
                syntheticState = createSyntheticSkillRiskState({
                  now: now(),
                  skillRiskFlags,
                  riskySkills
                });
              }
            }
          } catch (error) {
            logger.error("claw-aegis: \u672C\u8F6E skill \u98CE\u9669\u590D\u6838\u5931\u8D25", {
              event: "skill_prompt_guard_failed",
              hook: "before_prompt_build",
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
        const currentState = sessionKey ? state.consumePromptState(sessionKey) : syntheticState;
        const dynamicPromptContext = buildDynamicPromptContext(currentState);
        const prependSystemContext = joinPresentTextSegments([
          staticSystemContext,
          dynamicPromptContext
        ]);
        const durationMs = now() - startedAt;
        if (currentState?.prependNeeded) {
          logger.info("claw-aegis: \u5DF2\u6CE8\u5165\u63D0\u793A\u9632\u62A4", {
            event: "prompt_safeguards_injected",
            hook: "before_prompt_build",
            sessionKey,
            userRiskFlags: currentState.userRiskFlags.length,
            toolResultFlags: currentState.toolResultRiskFlags.length,
            toolResultSuspicious: currentState.toolResultSuspicious,
            skillRiskFlags: currentState.skillRiskFlags.length,
            riskySkills: currentState.riskySkills.length
          });
        }
        if (dynamicPromptContext && currentState) {
          const triggeredFlags = [];
          if (currentState.userRiskFlags.length > 0) {
            triggeredFlags.push(...currentState.userRiskFlags);
          }
          if (currentState.runtimeRiskFlags.length > 0) {
            triggeredFlags.push(...currentState.runtimeRiskFlags);
          }
          if (currentState.toolResultSuspicious) {
            triggeredFlags.push("tool_result_suspicious");
          }
          if (currentState.toolResultOversize) {
            triggeredFlags.push("tool_result_oversize");
          }
          if (currentState.toolResultRiskFlags.length > 0) {
            triggeredFlags.push(...currentState.toolResultRiskFlags);
          }
          if (currentState.riskySkills.length > 0) {
            triggeredFlags.push(...currentState.riskySkills.map((s) => `risky_skill:${s}`));
          }
          emitDefenseEvent({
            timestamp: now(),
            defense: "prompt_guard",
            result: "observed",
            reason: `提示防护已注入安全规则: ${triggeredFlags.join(", ")}`,
            details: {
              hook: "before_prompt_build",
              userRiskFlags: currentState.userRiskFlags,
              runtimeRiskFlags: currentState.runtimeRiskFlags,
              toolResultSuspicious: currentState.toolResultSuspicious,
              toolResultOversize: currentState.toolResultOversize,
              toolResultRiskFlags: currentState.toolResultRiskFlags,
              skillRiskFlags: currentState.skillRiskFlags,
              riskySkills: currentState.riskySkills
            },
            userInput: sessionKey ? state.peekLastUserInput(sessionKey) : void 0
          });
        }
        if (!prependSystemContext) {
          logDefenseResult(logger, {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result: "no_context_injected",
            durationMs
          });
          logDefenseFinish(logger, {
            hook: "before_prompt_build",
            mechanism: "prompt_guard",
            sessionKey,
            result: "no_context_injected",
            durationMs
          });
          return void 0;
        }
        const promptGuardResult = staticSystemContext && dynamicPromptContext ? "static_and_dynamic_injected" : staticSystemContext ? "static_only_injected" : "dynamic_only_injected";
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
            riskySkills: currentState?.riskySkills.length ?? 0
          },
          "info"
        );
        logDefenseFinish(logger, {
          hook: "before_prompt_build",
          mechanism: "prompt_guard",
          sessionKey,
          result: promptGuardResult,
          durationMs
        });
        return {
          prependSystemContext
        };
      },
      before_tool_call: (event, ctx) => {
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
        const toolCallModes = {
          selfProtection: selfProtectionMode,
          commandBlock: commandBlockMode,
          encodingGuard: encodingGuardMode,
          commandObfuscation: mergeDefenseModes(commandBlockMode, encodingGuardMode),
          scriptProvenanceGuard: scriptProvenanceGuardMode,
          memoryGuard: memoryGuardMode,
          loopGuard: loopGuardMode,
          exfiltrationGuard: exfiltrationGuardMode
        };
        const toolGuardStartedAt = now();
        logDefenseStart(logger, {
          hook: "before_tool_call",
          mechanism: "tool_call_guard",
          sessionKey,
          runId,
          toolName: normalizedToolName
        });
        const hasAnyEnabledStrategy = toolCallDefenseStrategies.some(
          (strategy) => isDefenseEnabled(resolveToolCallDefenseMode(toolCallModes, strategy.modeSource))
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
            durationMs
          });
          logDefenseFinish(logger, {
            hook: "before_tool_call",
            mechanism: "tool_call_guard",
            sessionKey,
            runId,
            toolName: normalizedToolName,
            result: "disabled",
            durationMs
          });
          return void 0;
        }
        const baseDir = process.cwd();
        const protectedRoots = isDefenseEnabled(selfProtectionMode) ? state.getProtectedRoots() : [];
        const pathCandidates = resolveProtectedPathCandidates(
          normalizedToolName,
          normalizedParams,
          baseDir
        );
        logger.debug?.("claw-aegis: \u5DF2\u89C4\u8303\u5316\u5DE5\u5177\u8C03\u7528", {
          event: "tool_call_normalized",
          hook: "before_tool_call",
          sessionKey,
          runId,
          toolName: normalizedToolName,
          candidateCount: pathCandidates.length
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
              fingerprintTimestamp
            )
          });
        }
        const runSecurityState = runId ? state.peekRunSecurityState(runId) : void 0;
        const promptSnapshot = sessionKey ? state.peekPromptSnapshot(sessionKey) : void 0;
        const commandText = readCommandText(normalizedParams);
        const toolCallContext = {
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
            isOutboundToolCall
          },
          state: {
            incrementLoopCounter: (nextSessionKey, nextRunId, stableArgsKey) => state.incrementLoopCounter(nextSessionKey, nextRunId, stableArgsKey),
            noteRunSecuritySignals: (nextRunId, payload) => state.noteRunSecuritySignals(nextRunId, payload),
            noteRuntimeRisk: (nextSessionKey, flags) => state.noteRuntimeRisk(nextSessionKey, flags),
            noteRunToolCall: (nextRunId, record) => state.noteRunToolCall(nextRunId, record)
          }
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
            toolName: normalizedToolName
          });
          const evaluation = strategy.evaluate(toolCallContext);
          const durationMs = now() - startedAt;
          const resultMeta = {
            hook: "before_tool_call",
            mechanism: strategy.id,
            sessionKey,
            runId,
            toolName: normalizedToolName,
            result: evaluation.result,
            durationMs,
            ...evaluation.extra ?? {}
          };
          if (evaluation.result === "blocked") {
            emitDefenseEvent({
              timestamp: now(),
              defense: strategy.id,
              result: "blocked",
              toolName: normalizedToolName,
              reason: evaluation.reason,
              details: evaluation.extra,
              commandText,
              toolParams: normalizedParams,
              userInput: sessionKey ? state.peekLastUserInput(sessionKey) : void 0
            });
            logger.warn(strategy.blockedMessage ?? "claw-aegis: \u5DF2\u963B\u6B62\u98CE\u9669\u5DE5\u5177\u8C03\u7528", {
              event: "tool_call_blocked",
              hook: "before_tool_call",
              toolName: normalizedToolName,
              sessionKey,
              runId,
              reason: evaluation.reason,
              ...evaluation.extra ?? {}
            });
            logDefenseFinish(logger, resultMeta);
            const totalDurationMs2 = now() - toolGuardStartedAt;
            logDefenseFinish(logger, {
              hook: "before_tool_call",
              mechanism: "tool_call_guard",
              sessionKey,
              runId,
              toolName: normalizedToolName,
              result: "blocked",
              durationMs: totalDurationMs2,
              blockedBy: strategy.id
            });
            return {
              block: true,
              blockReason: evaluation.reason
            };
          }
          if (evaluation.result === "observed") {
            emitDefenseEvent({
              timestamp: now(),
              defense: strategy.id,
              result: "observed",
              toolName: normalizedToolName,
              reason: evaluation.reason ?? "unknown",
              details: evaluation.extra,
              commandText,
              toolParams: normalizedParams,
              userInput: sessionKey ? state.peekLastUserInput(sessionKey) : void 0
            });
            logObservedToolCall({
              logger,
              mechanism: strategy.id,
              message: strategy.observedMessage ?? "claw-aegis: \u89C2\u5BDF\u8005\u6A21\u5F0F\u547D\u4E2D\u98CE\u9669\u5DE5\u5177\u8C03\u7528\uFF0C\u5DF2\u653E\u884C",
              sessionKey,
              runId,
              toolName: normalizedToolName,
              reason: evaluation.reason ?? "unknown",
              durationMs,
              extra: evaluation.extra
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
            timestamp: now()
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
          durationMs: totalDurationMs
        });
        logDefenseFinish(logger, {
          hook: "before_tool_call",
          mechanism: "tool_call_guard",
          sessionKey,
          runId,
          toolName: normalizedToolName,
          result: "allowed",
          durationMs: totalDurationMs
        });
        return void 0;
      },
      after_tool_call: (event, ctx) => {
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
            baseDir: process.cwd()
          });
          if (artifacts.length > 0) {
            state.noteRunScriptArtifacts(runId, {
              sessionKey,
              artifacts
            });
            const derivedSignals = deriveScriptArtifactSignals(artifacts);
            state.noteRunSecuritySignals(runId, {
              sessionKey,
              sourceSignals: derivedSignals.sourceSignals,
              transformSignals: derivedSignals.transformSignals,
              sinkSignals: derivedSignals.sinkSignals,
              runtimeRiskFlags: derivedSignals.runtimeRiskFlags
            });
            if (sessionKey && derivedSignals.runtimeRiskFlags.length > 0) {
              state.noteRuntimeRisk(sessionKey, derivedSignals.runtimeRiskFlags);
            }
            logger.info("claw-aegis: \u5DF2\u8BB0\u5F55\u672C\u8F6E\u65B0\u4EA7\u751F\u7684\u811A\u672C\u4EA7\u7269", {
              event: "script_artifacts_recorded",
              hook: "after_tool_call",
              sessionKey,
              runId,
              toolName: normalizedToolName,
              artifactCount: artifacts.length
            });
          }
        }
        const calls = state.peekRunToolCalls(runId);
        if (calls.length === 0) {
          return;
        }
        const blockedCount = calls.filter((call) => call.blocked).length;
        logger.info("claw-aegis: \u5DF2\u66F4\u65B0\u540C run \u5DE5\u5177\u8C03\u7528\u94FE", {
          event: "tool_call_chain_updated",
          hook: "after_tool_call",
          sessionKey,
          runId,
          totalCalls: calls.length,
          blockedCalls: blockedCount
        });
      },
      agent_end: (_event, ctx) => {
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
          logger.info("claw-aegis: \u5DF2\u6E05\u7406\u672C\u8F6E\u4E34\u65F6\u5B89\u5168\u72B6\u6001", {
            event: "agent_runtime_state_cleared",
            hook: "agent_end",
            sessionKey,
            runId
          });
        }
      },
      session_end: (_event, ctx) => {
        const sessionKey = ctx.sessionKey?.trim();
        if (!sessionKey) {
          return;
        }
        state.clearSessionRuntimeState(sessionKey);
        logger.info("claw-aegis: \u5DF2\u6E05\u7406 session \u7EA7\u4E34\u65F6\u5B89\u5168\u72B6\u6001", {
          event: "session_runtime_state_cleared",
          hook: "session_end",
          sessionKey
        });
      },
      before_message_write: (event, ctx) => {
        const startedAt = now();
        const sessionKey = ctx.sessionKey?.trim();
        const message = event.message;
        if (message.role === "assistant") {
          logDefenseStart(logger, {
            hook: "before_message_write",
            mechanism: "output_redaction",
            sessionKey
          });
          if (!config.outputRedactionEnabled) {
            const durationMs2 = now() - startedAt;
            logDefenseResult(logger, {
              hook: "before_message_write",
              mechanism: "output_redaction",
              sessionKey,
              result: "disabled",
              durationMs: durationMs2
            });
            logDefenseFinish(logger, {
              hook: "before_message_write",
              mechanism: "output_redaction",
              sessionKey,
              result: "disabled",
              durationMs: durationMs2
            });
            return void 0;
          }
          const observedSecrets = sessionKey ? state.peekObservedSecrets(sessionKey) : [];
          const sanitized = sanitizeAssistantMessage(message, { observedSecrets });
          const durationMs = now() - startedAt;
          if (sanitized.changed) {
            emitDefenseEvent({
              timestamp: now(),
              defense: "output_redaction",
              result: "observed",
              reason: `脱敏 assistant 输出 ${sanitized.redactionCount} 处`,
              details: { redactionCount: sanitized.redactionCount, matchedKeywords: sanitized.matchedKeywords },
            });
            logger.warn("claw-aegis: \u5DF2\u8131\u654F assistant \u8F93\u51FA\u4E2D\u7684\u654F\u611F\u5185\u5BB9", {
              event: "assistant_output_redacted",
              hook: "before_message_write",
              sessionKey,
              redactionCount: sanitized.redactionCount,
              matchedKeywords: sanitized.matchedKeywords,
              durationMs
            });
          }
          logDefenseResult(logger, {
            hook: "before_message_write",
            mechanism: "output_redaction",
            sessionKey,
            result: sanitized.changed ? "redacted" : "clear",
            durationMs,
            redactionCount: sanitized.redactionCount
          });
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "output_redaction",
            sessionKey,
            result: sanitized.changed ? "redacted" : "clear",
            durationMs,
            redactionCount: sanitized.redactionCount
          });
          return sanitized.changed ? { message: sanitized.message } : void 0;
        }
        logDefenseStart(logger, {
          hook: "before_message_write",
          mechanism: "tool_result_scan",
          sessionKey
        });
        if (!config.toolResultScanEnabled) {
          const durationMs = now() - startedAt;
          logDefenseResult(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: "disabled",
            durationMs
          });
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: "disabled",
            durationMs
          });
          return void 0;
        }
        if (!sessionKey || message.role !== "toolResult") {
          const durationMs = now() - startedAt;
          logDefenseResult(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: !sessionKey ? "skipped_missing_session" : "skipped_non_tool_result",
            durationMs
          });
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: !sessionKey ? "skipped_missing_session" : "skipped_non_tool_result",
            durationMs
          });
          return void 0;
        }
        try {
          const thirdPartyWebContent = isThirdPartyWebToolResultMessage(message);
          const toolName = typeof message.toolName === "string" ? message.toolName : void 0;
          const rawExtracted = thirdPartyWebContent ? collectToolResultScanText(message) : void 0;
          if (thirdPartyWebContent) {
            logger.info("claw-aegis: \u5F00\u59CB\u5904\u7406\u7B2C\u4E09\u65B9\u7F51\u9875\u5185\u5BB9", {
              event: "third_party_web_content_processing_started",
              hook: "before_message_write",
              sessionKey,
              toolName,
              contentCharsBefore: rawExtracted?.text.length ?? 0,
              oversizeBefore: rawExtracted?.oversize ?? false
            });
          }
          const sanitized = sanitizeToolResultMessage(message);
          const extracted = collectToolResultScanText(sanitized.message);
          const observedSecrets = collectSensitiveOutputValues(extracted.text);
          if (observedSecrets.length > 0) {
            state.noteObservedSecrets(sessionKey, observedSecrets);
          }
          if (thirdPartyWebContent || sanitized.externalContent) {
            logger.info("claw-aegis: \u5B8C\u6210\u5904\u7406\u7B2C\u4E09\u65B9\u7F51\u9875\u5185\u5BB9", {
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
              rewritten: sanitized.changed
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
            durationMs
          };
          if (outcome.suspicious || outcome.oversize || outcome.riskFlags.length > 0 || sanitized.removedTokenCount > 0) {
            emitDefenseEvent({
              timestamp: now(),
              defense: "tool_result_scan",
              result: "observed",
              toolName: typeof message.toolName === "string" ? message.toolName : undefined,
              reason: `风险标记: ${outcome.riskFlags.join(", ") || "suspicious/oversize"}`,
              details: { flags: outcome.riskFlags, suspicious: outcome.suspicious, oversize: outcome.oversize },
            });
            logger.warn("claw-aegis: \u5DF2\u5B8C\u6210\u5DE5\u5177\u7ED3\u679C\u5BA1\u67E5", logMeta);
          } else {
            logger.debug?.("claw-aegis: \u5DF2\u5B8C\u6210\u5DE5\u5177\u7ED3\u679C\u5BA1\u67E5", logMeta);
          }
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: outcome.suspicious || outcome.oversize || outcome.riskFlags.length > 0 || sanitized.removedTokenCount > 0 ? "risk_detected" : "clear",
            durationMs,
            flagCount: outcome.riskFlags.length,
            specialTokensRemoved: sanitized.removedTokenCount,
            markerInjected: sanitized.markerInjected
          });
          return sanitized.changed ? { message: sanitized.message } : void 0;
        } catch (error) {
          state.markToolResultSeen(sessionKey);
          const durationMs = now() - startedAt;
          logger.error("claw-aegis: \u5DE5\u5177\u7ED3\u679C\u626B\u63CF\u5DF2\u964D\u7EA7", {
            event: "tool_result_scan_failed",
            hook: "before_message_write",
            sessionKey,
            reason: error instanceof Error ? error.message : String(error),
            durationMs
          });
          logDefenseFinish(logger, {
            hook: "before_message_write",
            mechanism: "tool_result_scan",
            sessionKey,
            result: "degraded",
            durationMs
          });
        }
        return void 0;
      }
    }
  };
}
export {
  createClawAegisRuntime
};
