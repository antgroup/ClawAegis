import path from "node:path";
const CLAW_AEGIS_PLUGIN_ID = "claw-aegis";
const DEFENSE_MODES = ["off", "observe", "enforce"];
const TURN_STATE_TTL_MS = 5 * 6e4;
const LOOP_GUARD_TTL_MS = 5 * 6e4;
const LOOP_GUARD_ALLOW_COUNT = 3;
const STARTUP_SCAN_BUDGET_MS = 200;
const INLINE_EXEC_TEXT_MAX_CHARS = 8 * 1024;
const MEMORY_WRITE_MAX_CHARS = 8 * 1024;
const MEMORY_WRITE_MAX_LINES = 200;
const TOOL_RESULT_CHAR_BUDGET = 64 * 1024;
const TOOL_RESULT_MAX_DEPTH = 4;
const TOOL_RESULT_MAX_ARRAY_ITEMS = 200;
const SKILL_SCAN_QUEUE_MAX = 16;
const SKILL_SCAN_TIMEOUT_MS = 3e3;
const SKILL_SCAN_COOLDOWN_MS = 5 * 6e4;
const SKILL_SCAN_FAILURE_WINDOW_MS = 6e4;
const SKILL_SCAN_FAILURE_THRESHOLD = 3;
const SKILL_SCAN_FILE_MAX_BYTES = 100 * 1024;
const SKILL_SCAN_TARGET_FILENAME = "SKILL.md";
const TRUSTED_SKILLS_FILENAME = "trusted-skills.json";
const SELF_INTEGRITY_FILENAME = "self-integrity.json";
const DEFENSE_EVENTS_FILENAME = "defense-events.jsonl";
const SKILL_SCAN_EVENTS_FILENAME = "skill-scan-events.jsonl";
const BLOCK_REASON_PROTECTED_PATH = "\u5B89\u5168\u9650\u5236\uFF1A\u7981\u6B62\u8BBF\u95EE\u3001\u67E5\u8BE2\u3001\u4FEE\u6539\u3001\u5220\u9664\u3001\u5173\u95ED\u6216\u7ED5\u8FC7\u53D7\u4FDD\u62A4\u7684\u654F\u611F\u8DEF\u5F84\u3001\u914D\u7F6E\u3001\u91CD\u8981 skill \u6216 claw-aegis \u63D2\u4EF6\u76EE\u5F55\u3002";
const BLOCK_REASON_WORKSPACE_DELETE = "\u5B89\u5168\u9650\u5236\uFF1A\u7981\u6B62\u5220\u9664 workspace \u4E4B\u5916\u7684\u8DEF\u5F84\u3002";
const BLOCK_REASON_OPENCLAW_COMMAND = "\u5B89\u5168\u9650\u5236\uFF1A\u7981\u6B62\u6267\u884C openclaw CLI \u6216\u63A7\u5236\u547D\u4EE4\u3002";
const BLOCK_REASON_HIGH_RISK_OPERATION = "\u5B89\u5168\u9650\u5236\uFF1A\u5DF2\u963B\u6B62\u672C\u6B21\u9AD8\u98CE\u9669\u64CD\u4F5C\u8BF7\u6C42\u3002";
const BLOCK_REASON_MEMORY_WRITE = "\u5B89\u5168\u9650\u5236\uFF1A\u5DF2\u62D2\u7EDD\u672C\u6B21\u9AD8\u98CE\u9669\u8BB0\u5FC6\u5199\u5165\u3002";
const BLOCK_REASON_LOOP = "\u5B89\u5168\u9650\u5236\uFF1A\u68C0\u6D4B\u5230\u91CD\u590D\u9AD8\u98CE\u9669\u5DE5\u5177\u8C03\u7528\uFF0C\u5DF2\u505C\u6B62\u672C\u6B21\u64CD\u4F5C\u3002";
const BLOCK_REASON_EXFILTRATION_CHAIN = "\u5B89\u5168\u9650\u5236\uFF1A\u68C0\u6D4B\u5230\u7591\u4F3C SSRF \u6216\u6570\u636E\u5916\u6CC4\u5DE5\u5177\u8C03\u7528\u94FE\uFF0C\u5DF2\u963B\u6B62\u672C\u6B21\u51FA\u7AD9\u8BF7\u6C42\u3002";
const defaultEnabledBooleanSchema = {
  type: "boolean",
  default: true
};
const defaultDefenseModeSchema = {
  type: "string",
  enum: [...DEFENSE_MODES],
  default: "enforce"
};
const clawAegisPluginConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    allDefensesEnabled: defaultEnabledBooleanSchema,
    defaultBlockingMode: defaultDefenseModeSchema,
    selfProtectionEnabled: defaultEnabledBooleanSchema,
    selfProtectionMode: defaultDefenseModeSchema,
    commandBlockEnabled: defaultEnabledBooleanSchema,
    commandBlockMode: defaultDefenseModeSchema,
    encodingGuardEnabled: defaultEnabledBooleanSchema,
    encodingGuardMode: defaultDefenseModeSchema,
    scriptProvenanceGuardEnabled: defaultEnabledBooleanSchema,
    scriptProvenanceGuardMode: defaultDefenseModeSchema,
    memoryGuardEnabled: defaultEnabledBooleanSchema,
    memoryGuardMode: defaultDefenseModeSchema,
    userRiskScanEnabled: defaultEnabledBooleanSchema,
    skillScanEnabled: defaultEnabledBooleanSchema,
    toolResultScanEnabled: defaultEnabledBooleanSchema,
    outputRedactionEnabled: defaultEnabledBooleanSchema,
    promptGuardEnabled: defaultEnabledBooleanSchema,
    loopGuardEnabled: defaultEnabledBooleanSchema,
    loopGuardMode: defaultDefenseModeSchema,
    exfiltrationGuardEnabled: defaultEnabledBooleanSchema,
    exfiltrationGuardMode: defaultDefenseModeSchema,
    protectedPaths: {
      type: "array",
      items: { type: "string" }
    },
    protectedSkills: {
      type: "array",
      items: { type: "string" }
    },
    protectedPlugins: {
      type: "array",
      items: { type: "string" }
    },
    skillRoots: {
      type: "array",
      items: { type: "string" }
    },
    extraProtectedRoots: {
      type: "array",
      items: { type: "string" }
    },
    startupSkillScan: {
      type: "boolean",
      default: true
    }
  }
};
const clawAegisPluginUiHints = {
  allDefensesEnabled: {
    label: "Enable All Defenses",
    help: "Master switch for every claw-aegis defense below."
  },
  defaultBlockingMode: {
    label: "Default Blocking Mode",
    help: 'Default mode for blocking defenses. "enforce" blocks, "observe" only logs, and "off" disables the guard.'
  },
  selfProtectionEnabled: {
    label: "Protect Sensitive Paths",
    help: "Block reads, writes, deletes, and searches that target protected paths, important skills, or try to delete files outside the current workspace."
  },
  selfProtectionMode: {
    label: "Sensitive Path Mode",
    help: 'Detailed mode for protected-path defenses. "observe" records violations without blocking.'
  },
  commandBlockEnabled: {
    label: "Block High-Risk Commands",
    help: "Block clear high-risk shell patterns such as rm -rf / and curl | sh."
  },
  commandBlockMode: {
    label: "Command Block Mode",
    help: 'Detailed mode for high-risk command blocking. "observe" only reports detections.'
  },
  encodingGuardEnabled: {
    label: "Guard Encoded Payloads",
    help: "Detect bounded base64/base32/hex/url-encoded payloads that hide risky commands or exfiltration logic."
  },
  encodingGuardMode: {
    label: "Encoding Guard Mode",
    help: 'Detailed mode for encoded/obfuscated command guards. "observe" keeps the call allowed.'
  },
  scriptProvenanceGuardEnabled: {
    label: "Track Script Provenance",
    help: "Track newly written scripts in the current run and block later execution when they carry risky command or exfiltration signals."
  },
  scriptProvenanceGuardMode: {
    label: "Script Provenance Mode",
    help: 'Detailed mode for risky script provenance enforcement. "observe" logs the execution attempt only.'
  },
  memoryGuardEnabled: {
    label: "Guard Memory Writes",
    help: "Reject suspicious or oversized writes to memory_store, MEMORY.md, SOUL.md, and memory/."
  },
  memoryGuardMode: {
    label: "Memory Guard Mode",
    help: 'Detailed mode for risky memory writes. "observe" will keep the write allowed.'
  },
  userRiskScanEnabled: {
    label: "Scan User Intent",
    help: "Detect jailbreak, secret-exfiltration, and plugin-tampering requests in message_received."
  },
  skillScanEnabled: {
    label: "Scan Skills",
    help: "Enable the lightweight local skill scanner for ~/.openclaw/skills and ~/.openclaw/workspace/skills."
  },
  toolResultScanEnabled: {
    label: "Scan Tool Results",
    help: "Scan toolResult content for prompt-injection, secret-request, and exfiltration patterns."
  },
  outputRedactionEnabled: {
    label: "Redact Sensitive Output",
    help: "Mask API keys, tokens, and similar sensitive values before assistant output is sent or persisted."
  },
  promptGuardEnabled: {
    label: "Inject Prompt Guards",
    help: "Inject static and one-shot safety reminders during before_prompt_build."
  },
  loopGuardEnabled: {
    label: "Enable Loop Guard",
    help: "Stop repeated mutating tool calls after the allowed retry budget per run."
  },
  loopGuardMode: {
    label: "Loop Guard Mode",
    help: 'Detailed mode for repeated mutating calls. "observe" warns instead of stopping the run.'
  },
  exfiltrationGuardEnabled: {
    label: "Guard Exfiltration Chains",
    help: "Track prior tool calls per run and block suspicious outbound chains that resemble SSRF or secret exfiltration."
  },
  exfiltrationGuardMode: {
    label: "Exfiltration Guard Mode",
    help: 'Detailed mode for outbound chain detection. "observe" records the chain without blocking.'
  },
  protectedPaths: {
    label: "Protected Paths",
    help: "Additional absolute or resolved paths that should be treated as protected targets.",
    advanced: true,
    placeholder: "/path/to/protected"
  },
  protectedSkills: {
    label: "Protected Skills",
    help: "Additional skill IDs to protect under ~/.openclaw/skills and ~/.openclaw/workspace/skills.",
    advanced: true,
    placeholder: "release-guard"
  },
  protectedPlugins: {
    label: "Protected Plugins",
    help: "Additional plugin IDs to protect under extensions/, plugins/ state, and openclaw.json plugin entries.",
    advanced: true,
    placeholder: "audit-guard"
  },
  startupSkillScan: {
    label: "Scan Skills at Startup",
    help: "Run a bounded startup scan for ~/.openclaw/skills and ~/.openclaw/workspace/skills.",
    advanced: true
  },
  skillRoots: {
    label: "Additional Skill Roots (Ignored)",
    help: "Deprecated. claw-aegis v1 now scans only ~/.openclaw/skills and ~/.openclaw/workspace/skills.",
    advanced: true,
    placeholder: "/path/to/skills"
  },
  extraProtectedRoots: {
    label: "Additional Protected Roots",
    help: "Legacy compatibility alias of protectedPaths. Extra directories that claw-aegis should treat as protected paths.",
    advanced: true,
    placeholder: "/path/to/protected"
  }
};
const clawAegisPluginConfigDefinition = {
  jsonSchema: clawAegisPluginConfigSchema,
  uiHints: clawAegisPluginUiHints
};
function normalizeStringList(value, resolvePath) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const resolved = path.resolve(resolvePath(trimmed));
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    results.push(resolved);
  }
  return results;
}
function normalizeIdentifierList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim().normalize("NFKC").toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}
function readEnabledFlag(raw, key, allDefensesEnabled) {
  return allDefensesEnabled && raw[key] !== false;
}
function isDefenseMode(value) {
  return typeof value === "string" && DEFENSE_MODES.includes(value);
}
function readDefenseMode(raw, params) {
  if (!params.allDefensesEnabled || raw[params.enabledKey] === false) {
    return "off";
  }
  const explicitMode = raw[params.modeKey];
  return isDefenseMode(explicitMode) ? explicitMode : params.defaultMode;
}
function resolveClawAegisPluginConfig(api) {
  const raw = api.pluginConfig ?? {};
  const allDefensesEnabled = raw.allDefensesEnabled !== false;
  const defaultBlockingMode = isDefenseMode(raw.defaultBlockingMode) ? raw.defaultBlockingMode : "enforce";
  const selfProtectionMode = readDefenseMode(raw, {
    enabledKey: "selfProtectionEnabled",
    modeKey: "selfProtectionMode",
    defaultMode: defaultBlockingMode,
    allDefensesEnabled
  });
  const commandBlockMode = readDefenseMode(raw, {
    enabledKey: "commandBlockEnabled",
    modeKey: "commandBlockMode",
    defaultMode: defaultBlockingMode,
    allDefensesEnabled
  });
  const encodingGuardMode = readDefenseMode(raw, {
    enabledKey: "encodingGuardEnabled",
    modeKey: "encodingGuardMode",
    defaultMode: defaultBlockingMode,
    allDefensesEnabled
  });
  const scriptProvenanceGuardMode = readDefenseMode(raw, {
    enabledKey: "scriptProvenanceGuardEnabled",
    modeKey: "scriptProvenanceGuardMode",
    defaultMode: defaultBlockingMode,
    allDefensesEnabled
  });
  const memoryGuardMode = readDefenseMode(raw, {
    enabledKey: "memoryGuardEnabled",
    modeKey: "memoryGuardMode",
    defaultMode: defaultBlockingMode,
    allDefensesEnabled
  });
  const loopGuardMode = readDefenseMode(raw, {
    enabledKey: "loopGuardEnabled",
    modeKey: "loopGuardMode",
    defaultMode: defaultBlockingMode,
    allDefensesEnabled
  });
  const exfiltrationGuardMode = readDefenseMode(raw, {
    enabledKey: "exfiltrationGuardEnabled",
    modeKey: "exfiltrationGuardMode",
    defaultMode: defaultBlockingMode,
    allDefensesEnabled
  });
  return {
    allDefensesEnabled,
    defaultBlockingMode,
    selfProtectionEnabled: selfProtectionMode !== "off",
    selfProtectionMode,
    commandBlockEnabled: commandBlockMode !== "off",
    commandBlockMode,
    encodingGuardEnabled: encodingGuardMode !== "off",
    encodingGuardMode,
    scriptProvenanceGuardEnabled: scriptProvenanceGuardMode !== "off",
    scriptProvenanceGuardMode,
    memoryGuardEnabled: memoryGuardMode !== "off",
    memoryGuardMode,
    userRiskScanEnabled: readEnabledFlag(raw, "userRiskScanEnabled", allDefensesEnabled),
    skillScanEnabled: readEnabledFlag(raw, "skillScanEnabled", allDefensesEnabled),
    toolResultScanEnabled: readEnabledFlag(raw, "toolResultScanEnabled", allDefensesEnabled),
    outputRedactionEnabled: readEnabledFlag(raw, "outputRedactionEnabled", allDefensesEnabled),
    promptGuardEnabled: readEnabledFlag(raw, "promptGuardEnabled", allDefensesEnabled),
    loopGuardEnabled: loopGuardMode !== "off",
    loopGuardMode,
    exfiltrationGuardEnabled: exfiltrationGuardMode !== "off",
    exfiltrationGuardMode,
    protectedPaths: normalizeStringList(raw.protectedPaths, api.resolvePath),
    protectedSkills: normalizeIdentifierList(raw.protectedSkills),
    protectedPlugins: normalizeIdentifierList(raw.protectedPlugins),
    skillRoots: normalizeStringList(raw.skillRoots, api.resolvePath),
    extraProtectedRoots: normalizeStringList(raw.extraProtectedRoots, api.resolvePath),
    startupSkillScan: raw.startupSkillScan !== false
  };
}
function resolveClawAegisStateDir(api) {
  return path.join(api.runtime.state.resolveStateDir(), "plugins", CLAW_AEGIS_PLUGIN_ID);
}
function resolveSkillScanRoots(api) {
  const stateRoot = path.resolve(api.runtime.state.resolveStateDir());
  return [path.join(stateRoot, "skills"), path.join(stateRoot, "workspace", "skills")];
}
export {
  BLOCK_REASON_EXFILTRATION_CHAIN,
  BLOCK_REASON_HIGH_RISK_OPERATION,
  BLOCK_REASON_LOOP,
  BLOCK_REASON_MEMORY_WRITE,
  BLOCK_REASON_OPENCLAW_COMMAND,
  BLOCK_REASON_PROTECTED_PATH,
  BLOCK_REASON_WORKSPACE_DELETE,
  CLAW_AEGIS_PLUGIN_ID,
  DEFENSE_EVENTS_FILENAME,
  DEFENSE_MODES,
  SKILL_SCAN_EVENTS_FILENAME,
  INLINE_EXEC_TEXT_MAX_CHARS,
  LOOP_GUARD_ALLOW_COUNT,
  LOOP_GUARD_TTL_MS,
  MEMORY_WRITE_MAX_CHARS,
  MEMORY_WRITE_MAX_LINES,
  SELF_INTEGRITY_FILENAME,
  SKILL_SCAN_COOLDOWN_MS,
  SKILL_SCAN_FAILURE_THRESHOLD,
  SKILL_SCAN_FAILURE_WINDOW_MS,
  SKILL_SCAN_FILE_MAX_BYTES,
  SKILL_SCAN_QUEUE_MAX,
  SKILL_SCAN_TARGET_FILENAME,
  SKILL_SCAN_TIMEOUT_MS,
  STARTUP_SCAN_BUDGET_MS,
  TOOL_RESULT_CHAR_BUDGET,
  TOOL_RESULT_MAX_ARRAY_ITEMS,
  TOOL_RESULT_MAX_DEPTH,
  TRUSTED_SKILLS_FILENAME,
  TURN_STATE_TTL_MS,
  clawAegisPluginConfigDefinition,
  clawAegisPluginConfigSchema,
  clawAegisPluginUiHints,
  resolveClawAegisPluginConfig,
  resolveClawAegisStateDir,
  resolveSkillScanRoots
};
