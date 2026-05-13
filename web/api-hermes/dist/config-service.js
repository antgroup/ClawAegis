/**
 * Config service for Hermes adapter.
 *
 * Reads/writes configuration from config.yaml instead of openclaw.plugin.json.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
const CONFIG_DEFAULTS = {
    allDefensesEnabled: true,
    defaultBlockingMode: "enforce",
    selfProtectionEnabled: true,
    selfProtectionMode: "enforce",
    commandBlockEnabled: true,
    commandBlockMode: "enforce",
    encodingGuardEnabled: true,
    encodingGuardMode: "enforce",
    scriptProvenanceGuardEnabled: true,
    scriptProvenanceGuardMode: "enforce",
    memoryGuardEnabled: true,
    memoryGuardMode: "enforce",
    userRiskScanEnabled: true,
    skillScanEnabled: true,
    toolResultScanEnabled: true,
    outputRedactionEnabled: true,
    promptGuardEnabled: true,
    loopGuardEnabled: true,
    loopGuardMode: "enforce",
    exfiltrationGuardEnabled: true,
    exfiltrationGuardMode: "enforce",
    toolCallEnforcementEnabled: true,
    dispatchGuardEnabled: true,
    dispatchGuardMode: "enforce",
    protectedPaths: [],
    protectedSkills: [],
    protectedPlugins: [],
    startupSkillScan: true,
};
export class ConfigService {
    configPath;
    lastMtime = null;
    constructor(configDir) {
        this.configPath = path.join(configDir, "config.yaml");
    }
    getConfigPath() {
        return this.configPath;
    }
    async getConfigMtime() {
        try {
            const stat = await fs.stat(this.configPath);
            this.lastMtime = stat.mtime;
            return stat.mtime.toISOString();
        }
        catch {
            return null;
        }
    }
    async readConfigFile() {
        const raw = await fs.readFile(this.configPath, "utf8");
        return yaml.load(raw) ?? {};
    }
    async writeConfigFile(data) {
        const dir = path.dirname(this.configPath);
        await fs.mkdir(dir, { recursive: true });
        const tempPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(tempPath, yaml.dump(data, { indent: 2 }), "utf8");
            await fs.rename(tempPath, this.configPath);
        }
        finally {
            await fs.rm(tempPath, { force: true }).catch(() => undefined);
        }
    }
    async getUserConfig() {
        try {
            return await this.readConfigFile();
        }
        catch {
            return {};
        }
    }
    resolveConfig(userConfig) {
        const allDefensesEnabled = userConfig.allDefensesEnabled !== false
            ? CONFIG_DEFAULTS.allDefensesEnabled
            : false;
        const raw = userConfig;
        const isMode = (v) => typeof v === "string" && ["off", "observe", "enforce"].includes(v);
        const defaultMode = isMode(raw.defaultBlockingMode)
            ? raw.defaultBlockingMode
            : CONFIG_DEFAULTS.defaultBlockingMode;
        const readEnabled = (key) => allDefensesEnabled && raw[key] !== false;
        const readMode = (enabledKey, modeKey) => {
            if (!allDefensesEnabled || raw[enabledKey] === false)
                return "off";
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
        const dispatchGuardMode = readMode("dispatchGuardEnabled", "dispatchGuardMode");
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
            toolCallEnforcementEnabled: readEnabled("toolCallEnforcementEnabled"),
            dispatchGuardEnabled: dispatchGuardMode !== "off",
            dispatchGuardMode,
            protectedPaths: normalizeStringArray(raw.protectedPaths),
            protectedSkills: raw.protectedSkills !== undefined
                ? normalizeStringArray(raw.protectedSkills)
                : CONFIG_DEFAULTS.protectedSkills,
            protectedPlugins: normalizeStringArray(raw.protectedPlugins),
            startupSkillScan: raw.startupSkillScan !== false,
        };
    }
    async getResolvedConfig() {
        const userConfig = await this.getUserConfig();
        return this.resolveConfig(userConfig);
    }
    async updateConfig(update) {
        const currentConfig = await this.getUserConfig();
        const merged = { ...currentConfig };
        for (const [key, value] of Object.entries(update)) {
            if (value !== undefined) {
                merged[key] = value;
            }
        }
        await this.writeConfigFile(merged);
        return this.resolveConfig(merged);
    }
    async resetConfig() {
        await this.writeConfigFile({});
        return this.resolveConfig({});
    }
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => typeof item === "string")
        .map((s) => s.trim())
        .filter(Boolean);
}
//# sourceMappingURL=config-service.js.map