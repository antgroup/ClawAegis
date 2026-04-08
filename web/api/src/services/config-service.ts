import { promises as fs } from "node:fs";
import path from "node:path";
import type { AegisConfig, ConfigUpdateRequest } from "@claw-aegis-web/shared";
import { CONFIG_DEFAULTS, aegisConfigSchema } from "@claw-aegis-web/shared";

type PluginJson = {
  id: string;
  name: string;
  userConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

export class ConfigService {
  private readonly pluginJsonPath: string;
  private lastMtime: Date | null = null;

  constructor(configDir: string) {
    this.pluginJsonPath = path.join(configDir, "openclaw.plugin.json");
  }

  getPluginJsonPath(): string {
    return this.pluginJsonPath;
  }

  async getConfigMtime(): Promise<string | null> {
    try {
      const stat = await fs.stat(this.pluginJsonPath);
      this.lastMtime = stat.mtime;
      return stat.mtime.toISOString();
    } catch {
      return null;
    }
  }

  private async readPluginJson(): Promise<PluginJson> {
    const raw = await fs.readFile(this.pluginJsonPath, "utf8");
    return JSON.parse(raw) as PluginJson;
  }

  private async writePluginJson(data: PluginJson): Promise<void> {
    const dir = path.dirname(this.pluginJsonPath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${this.pluginJsonPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
      await fs.rename(tempPath, this.pluginJsonPath);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async getUserConfig(): Promise<Record<string, unknown>> {
    try {
      const pluginJson = await this.readPluginJson();
      return (pluginJson.userConfig as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }

  resolveConfig(userConfig: Record<string, unknown>): AegisConfig {
    const allDefensesEnabled = userConfig.allDefensesEnabled !== false
      ? CONFIG_DEFAULTS.allDefensesEnabled
      : false;

    const raw = userConfig;
    const isMode = (v: unknown): v is "off" | "observe" | "enforce" =>
      typeof v === "string" && ["off", "observe", "enforce"].includes(v);

    const defaultMode = isMode(raw.defaultBlockingMode)
      ? raw.defaultBlockingMode
      : CONFIG_DEFAULTS.defaultBlockingMode;

    const readEnabled = (key: string) =>
      allDefensesEnabled && raw[key] !== false;

    const readMode = (enabledKey: string, modeKey: string): "off" | "observe" | "enforce" => {
      if (!allDefensesEnabled || raw[enabledKey] === false) return "off";
      const explicit = raw[modeKey];
      return isMode(explicit) ? explicit : defaultMode;
    };

    const selfProtectionMode = readMode("selfProtectionEnabled", "selfProtectionMode");
    const commandBlockMode = readMode("commandBlockEnabled", "commandBlockMode");
    const encodingGuardMode = readMode("encodingGuardEnabled", "encodingGuardMode");
    const scriptProvenanceGuardMode = readMode("scriptProvenanceGuardEnabled", "scriptProvenanceGuardMode");
    const memoryGuardMode = readMode("memoryGuardEnabled", "memoryGuardMode");
    const loopGuardMode = readMode("loopGuardEnabled", "loopGuardMode");
    const exfiltrationGuardMode = readMode("exfiltrationGuardEnabled", "exfiltrationGuardMode");

    return {
      allDefensesEnabled,
      defaultBlockingMode: defaultMode,
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
      userRiskScanEnabled: readEnabled("userRiskScanEnabled"),
      skillScanEnabled: readEnabled("skillScanEnabled"),
      toolResultScanEnabled: readEnabled("toolResultScanEnabled"),
      outputRedactionEnabled: readEnabled("outputRedactionEnabled"),
      promptGuardEnabled: readEnabled("promptGuardEnabled"),
      loopGuardEnabled: loopGuardMode !== "off",
      loopGuardMode,
      exfiltrationGuardEnabled: exfiltrationGuardMode !== "off",
      exfiltrationGuardMode,
      protectedPaths: normalizeStringArray(raw.protectedPaths),
      protectedSkills: raw.protectedSkills !== undefined
        ? normalizeStringArray(raw.protectedSkills)
        : CONFIG_DEFAULTS.protectedSkills,
      protectedPlugins: normalizeStringArray(raw.protectedPlugins),
      startupSkillScan: raw.startupSkillScan !== false,
    };
  }

  async getResolvedConfig(): Promise<AegisConfig> {
    const userConfig = await this.getUserConfig();
    return this.resolveConfig(userConfig);
  }

  async updateConfig(update: ConfigUpdateRequest): Promise<AegisConfig> {
    const parsed = aegisConfigSchema.parse(update);

    const pluginJson = await this.readPluginJson();
    const currentUser = (pluginJson.userConfig as Record<string, unknown>) ?? {};

    const merged: Record<string, unknown> = { ...currentUser };
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }

    pluginJson.userConfig = merged;
    await this.writePluginJson(pluginJson);

    return this.resolveConfig(merged);
  }

  async resetConfig(): Promise<AegisConfig> {
    const pluginJson = await this.readPluginJson();
    delete pluginJson.userConfig;
    await this.writePluginJson(pluginJson);
    return this.resolveConfig({});
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}
