import { Router } from "express";
import { ConfigService } from "../config-service.js";
import { StateService } from "../state-service.js";
import { AegisRpcClient } from "../rpc-client.js";

// Defense group metadata for the UI (copied from shared package)
type DefenseGroupMeta = {
  id: string;
  label: string;
  help: string;
  enabledKey: string;
  modeKey?: string;
};

const DEFENSE_GROUPS: DefenseGroupMeta[] = [
  {
    id: "selfProtection",
    label: "Protect Sensitive Paths",
    help: "Block reads, writes, deletes, and searches that target protected paths, important skills, or try to delete files outside the current workspace.",
    enabledKey: "selfProtectionEnabled",
    modeKey: "selfProtectionMode",
  },
  {
    id: "commandBlock",
    label: "Block High-Risk Commands",
    help: "Block clear high-risk shell patterns such as rm -rf / and curl | sh.",
    enabledKey: "commandBlockEnabled",
    modeKey: "commandBlockMode",
  },
  {
    id: "encodingGuard",
    label: "Guard Encoded Payloads",
    help: "Detect bounded base64/base32/hex/url-encoded payloads that hide risky commands or exfiltration logic.",
    enabledKey: "encodingGuardEnabled",
    modeKey: "encodingGuardMode",
  },
  {
    id: "scriptProvenanceGuard",
    label: "Track Script Provenance",
    help: "Track newly written scripts in the current run and block later execution when they carry risky command or exfiltration signals.",
    enabledKey: "scriptProvenanceGuardEnabled",
    modeKey: "scriptProvenanceGuardMode",
  },
  {
    id: "memoryGuard",
    label: "Guard Memory Writes",
    help: "Reject suspicious or oversized writes to memory_store, MEMORY.md, SOUL.md, and memory/.",
    enabledKey: "memoryGuardEnabled",
    modeKey: "memoryGuardMode",
  },
  {
    id: "loopGuard",
    label: "Enable Loop Guard",
    help: "Stop repeated mutating tool calls after the allowed retry budget per run.",
    enabledKey: "loopGuardEnabled",
    modeKey: "loopGuardMode",
  },
  {
    id: "exfiltrationGuard",
    label: "Guard Exfiltration Chains",
    help: "Track prior tool calls per run and block suspicious outbound chains that resemble SSRF or secret exfiltration.",
    enabledKey: "exfiltrationGuardEnabled",
    modeKey: "exfiltrationGuardMode",
  },
  {
    id: "userRiskScan",
    label: "Scan User Intent",
    help: "Detect jailbreak, secret-exfiltration, and plugin-tampering requests in message_received.",
    enabledKey: "userRiskScanEnabled",
  },
  {
    id: "skillScan",
    label: "Scan Skills",
    help: "Enable the lightweight local skill scanner for skills directories.",
    enabledKey: "skillScanEnabled",
  },
  {
    id: "toolResultScan",
    label: "Scan Tool Results",
    help: "Scan toolResult content for prompt-injection, secret-request, and exfiltration patterns.",
    enabledKey: "toolResultScanEnabled",
  },
  {
    id: "outputRedaction",
    label: "Redact Sensitive Output",
    help: "Mask API keys, tokens, and similar sensitive values before assistant output is sent or persisted.",
    enabledKey: "outputRedactionEnabled",
  },
  {
    id: "promptGuard",
    label: "Inject Prompt Guards",
    help: "Inject static and one-shot safety reminders during prompt building.",
    enabledKey: "promptGuardEnabled",
  },
  {
    id: "toolCallEnforcement",
    label: "Enforce Tool Call Only",
    help: "Inject prompt rules requiring all destructive operations to go through standard tool calls, preventing bypass of security hooks.",
    enabledKey: "toolCallEnforcementEnabled",
  },
  {
    id: "dispatchGuard",
    label: "Dispatch Guard",
    help: "Intercept dangerous operation requests before they reach the AI agent and before LLM replies, including CLI commands, protected path destruction, and tool call bypass attempts.",
    enabledKey: "dispatchGuardEnabled",
    modeKey: "dispatchGuardMode",
  },
];

type DefenseStatusEntry = {
  id: string;
  label: string;
  help: string;
  enabled: boolean;
  mode?: "off" | "observe" | "enforce";
};

type StatusResponse = {
  defenses: DefenseStatusEntry[];
  integrity: {
    valid: boolean;
    protectedRoots: string[];
    fingerprintCount: number;
    updatedAt: number;
  } | null;
  trustedSkillCount: number;
  configMtime: string | null;
};

export function createStatusRouter(
  configService: ConfigService,
  stateService: StateService,
  rpcClient?: AegisRpcClient
): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const [config, integrity, trustedSkills, mtime] = await Promise.all([
        configService.getResolvedConfig(),
        stateService.getSelfIntegrity(),
        stateService.getTrustedSkills(),
        configService.getConfigMtime(),
      ]);

      const defenses: DefenseStatusEntry[] = DEFENSE_GROUPS.map((group) => {
        const enabledKey = group.enabledKey as keyof typeof config;
        const modeKey = group.modeKey as keyof typeof config | undefined;
        return {
          id: group.id,
          label: group.label,
          help: group.help,
          enabled: Boolean(config[enabledKey]),
          mode: modeKey ? (config[modeKey] as DefenseStatusEntry["mode"]) : undefined,
        };
      });

      const status: StatusResponse = {
        defenses,
        integrity,
        trustedSkillCount: trustedSkills.length,
        configMtime: mtime,
      };

      res.json({ ok: true, data: status });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
