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
import { BLOCK_REASON_EXFILTRATION_CHAIN, BLOCK_REASON_HIGH_RISK_OPERATION, BLOCK_REASON_LOOP, BLOCK_REASON_MEMORY_WRITE, BLOCK_REASON_PROTECTED_PATH, BLOCK_REASON_WORKSPACE_DELETE, DEFENSE_EVENTS_FILENAME, LOOP_GUARD_ALLOW_COUNT, SKILL_SCAN_EVENTS_FILENAME, STARTUP_SCAN_BUDGET_MS, } from "./src/config.js";
import { buildDynamicPromptContext, buildLoopGuardStableArgsKey, buildStaticSystemContext, collectScriptArtifactRecords, collectSensitiveOutputValues, collectToolResultScanText, detectCommandObfuscationViolation, detectHighRiskCommand, detectUserRiskFlags, isOutboundToolCall, normalizeToolName, normalizeToolParamsForGuard, resolveInlineExecutionViolation, resolveMemoryGuardViolation, resolveOutsideWorkspaceDeletionViolation, resolveProtectedPathCandidates, resolveProtectedPathViolation, resolveScriptProvenanceViolation, reviewSuspiciousOutboundChain, sanitizeSensitiveOutputText, scanToolResultText, } from "./src/rules.js";
import { SkillScanService } from "./src/scan-service.js";
import { ClawAegisState } from "./src/state.js";
// ---------------------------------------------------------------------------
// Runtime (agent-agnostic)
// ---------------------------------------------------------------------------
export class AegisRpcRuntime {
    config;
    state;
    scanService;
    logger;
    stateDir;
    pluginRootDir;
    staticSystemContext;
    initialized = false;
    defenseEventWriter;
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
    async init(params) {
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
        const emitSkillScanEvent = this.createEventWriter(path.join(this.stateDir, SKILL_SCAN_EVENTS_FILENAME));
        this.defenseEventWriter = this.createEventWriter(path.join(this.stateDir, DEFENSE_EVENTS_FILENAME));
        this.scanService = new SkillScanService({
            state: this.state,
            logger: this.logger,
            onScanComplete: emitSkillScanEvent,
        });
        if (this.config.skillScanEnabled && this.config.startupSkillScan && params.skillRoots) {
            const deadline = Date.now() + STARTUP_SCAN_BUDGET_MS;
            for (const root of params.skillRoots) {
                if (Date.now() >= deadline)
                    break;
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
    checkUserInput(params) {
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
    getPromptGuard(params) {
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
        const parts = [];
        if (this.staticSystemContext)
            parts.push(this.staticSystemContext);
        if (dynamicContext)
            parts.push(dynamicContext);
        return { context: parts.length > 0 ? parts.join("\n\n") : null };
    }
    // -----------------------------------------------------------------------
    // check_before_tool
    // -----------------------------------------------------------------------
    checkBeforeTool(params) {
        this.ensureInit();
        const tool = normalizeToolName(params.tool);
        const args = normalizeToolParamsForGuard(params.args);
        const runId = params.runId ?? "unknown";
        const sessionKey = params.sessionKey ?? "default";
        // --- self protection ---
        if (this.config.selfProtectionEnabled) {
            const candidates = resolveProtectedPathCandidates(tool, args);
            for (const candidate of candidates) {
                const violation = resolveProtectedPathViolation(tool, args, this.state.getProtectedRoots());
                if (violation.blocked) {
                    return this.makeToolResult(this.config.selfProtectionMode, "self_protection", BLOCK_REASON_PROTECTED_PATH, "high", { path: candidate, violation });
                }
                const deletionViolation = resolveOutsideWorkspaceDeletionViolation(tool, args, candidate);
                if (deletionViolation) {
                    return this.makeToolResult(this.config.selfProtectionMode, "self_protection", BLOCK_REASON_WORKSPACE_DELETE, "high", { path: candidate });
                }
            }
        }
        // --- command block ---
        const commandText = this.readCommandText(args);
        if (commandText && this.config.commandBlockEnabled) {
            const highRisk = detectHighRiskCommand(commandText);
            if (highRisk) {
                return this.makeToolResult(this.config.commandBlockMode, "command_block", BLOCK_REASON_HIGH_RISK_OPERATION, "critical", { pattern: highRisk });
            }
            // --- command obfuscation ---
            const obfuscation = detectCommandObfuscationViolation(commandText);
            if (obfuscation) {
                return this.makeToolResult(this.config.commandBlockMode, "command_obfuscation", BLOCK_REASON_HIGH_RISK_OPERATION, "high", { pattern: obfuscation });
            }
        }
        // --- encoding guard ---
        if (commandText && this.config.encodingGuardEnabled) {
            const inlineViolation = resolveInlineExecutionViolation(commandText, this.state.getProtectedRoots());
            if (inlineViolation) {
                return this.makeToolResult(this.config.encodingGuardMode, "encoding_guard", BLOCK_REASON_HIGH_RISK_OPERATION, "high", { reason: inlineViolation });
            }
        }
        // --- memory guard ---
        if (this.config.memoryGuardEnabled) {
            const candidates = resolveProtectedPathCandidates(tool, args);
            const memoryViolation = resolveMemoryGuardViolation(tool, args, candidates);
            if (memoryViolation) {
                return this.makeToolResult(this.config.memoryGuardMode, "memory_guard", BLOCK_REASON_MEMORY_WRITE, "medium", { reason: memoryViolation });
            }
        }
        // --- script provenance guard ---
        if (commandText && this.config.scriptProvenanceGuardEnabled) {
            const runState = this.state.peekRunSecurityState(runId);
            if (runState) {
                const provenanceViolation = resolveScriptProvenanceViolation(tool, args, runState.scriptArtifacts);
                if (provenanceViolation) {
                    return this.makeToolResult(this.config.scriptProvenanceGuardMode, "script_provenance", BLOCK_REASON_HIGH_RISK_OPERATION, "high", { reason: provenanceViolation });
                }
            }
        }
        // --- loop guard ---
        if (this.config.loopGuardEnabled) {
            const stableKey = buildLoopGuardStableArgsKey(tool, args);
            if (stableKey) {
                const count = this.state.incrementLoopCounter(sessionKey, runId, stableKey);
                if (count > LOOP_GUARD_ALLOW_COUNT) {
                    return this.makeToolResult(this.config.loopGuardMode, "loop_guard", BLOCK_REASON_LOOP, "medium", { count, stableKey });
                }
            }
        }
        // --- exfiltration guard ---
        if (this.config.exfiltrationGuardEnabled && isOutboundToolCall(tool, args)) {
            const runState = this.state.peekRunSecurityState(runId);
            if (runState) {
                const chainReview = reviewSuspiciousOutboundChain(tool, args, [], // previousToolCalls - would need to be retrieved from state
                { runSecurityState: runState });
                if (chainReview.blocked) {
                    return this.makeToolResult(this.config.exfiltrationGuardMode, "exfiltration_guard", BLOCK_REASON_EXFILTRATION_CHAIN, "critical", { signals: chainReview.matchedConditions });
                }
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
    checkToolResult(params) {
        this.ensureInit();
        if (!this.config.toolResultScanEnabled) {
            return { riskFlags: [], suspicious: false };
        }
        const message = { content: params.result };
        const textResult = collectToolResultScanText(message);
        const text = typeof textResult === 'string' ? textResult : textResult.text || '';
        const outcome = scanToolResultText(text, textResult.oversize || false);
        const sessionKey = params.sessionKey ?? "default";
        if (outcome.riskFlags.length > 0 || outcome.suspicious) {
            this.state.noteToolResult(sessionKey, outcome);
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
    redactOutput(params) {
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
    updateState(params) {
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
    getConfig() {
        this.ensureInit();
        return { ...this.config };
    }
    // -----------------------------------------------------------------------
    // scan_skills
    // -----------------------------------------------------------------------
    async scanSkills(params) {
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
    async dispatch(request) {
        const { id, method, params = {} } = request;
        try {
            let result;
            switch (method) {
                case "init":
                    result = await this.init(params);
                    break;
                case "check_user_input":
                    result = this.checkUserInput(params);
                    break;
                case "get_prompt_guard":
                    result = this.getPromptGuard(params);
                    break;
                case "check_before_tool":
                    result = this.checkBeforeTool(params);
                    break;
                case "check_tool_result":
                    result = this.checkToolResult(params);
                    break;
                case "redact_output":
                    result = this.redactOutput(params);
                    break;
                case "update_state":
                    result = this.updateState(params);
                    break;
                case "get_config":
                    result = this.getConfig();
                    break;
                case "scan_skills":
                    result = await this.scanSkills(params);
                    break;
                case "ping":
                    result = { pong: true, initialized: this.initialized };
                    break;
                default:
                    return { id, error: { message: `Unknown method: ${method}`, code: -32601 } };
            }
            return { id, result };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`RPC method ${method} failed: ${message}`);
            return { id, error: { message, code: -32000 } };
        }
    }
    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------
    ensureInit() {
        if (!this.initialized) {
            throw new Error("AegisRpcRuntime not initialized — call init first");
        }
    }
    readCommandText(args) {
        for (const key of ["command", "cmd", "code", "script"]) {
            const value = args[key];
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }
        return undefined;
    }
    makeToolResult(mode, defense, reason, severity, details) {
        const block = mode === "enforce";
        this.emitDefenseEvent({ defense, mode, reason, severity, blocked: block, details });
        return { block, mode, defense, reason, severity, details };
    }
    emitDefenseEvent(event) {
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
    createEventWriter(filePath) {
        const dir = path.dirname(filePath);
        let ensured = false;
        return (event) => {
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
    resolveConfig(raw) {
        const allDefensesEnabled = raw.allDefensesEnabled !== false;
        const defaultBlockingMode = raw.defaultBlockingMode ?? "enforce";
        const resolveMode = (enabled, mode) => {
            if (!allDefensesEnabled || enabled === false)
                return "off";
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
            scriptProvenanceGuardEnabled: allDefensesEnabled && raw.scriptProvenanceGuardEnabled !== false,
            scriptProvenanceGuardMode: resolveMode(raw.scriptProvenanceGuardEnabled, raw.scriptProvenanceGuardMode),
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
            toolCallEnforcementEnabled: allDefensesEnabled && raw.toolCallEnforcementEnabled !== false,
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
