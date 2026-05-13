/**
 * Config service for Hermes adapter.
 *
 * Reads/writes configuration from config.yaml instead of openclaw.plugin.json.
 */
export type AegisConfig = {
    allDefensesEnabled: boolean;
    defaultBlockingMode: "off" | "observe" | "enforce";
    selfProtectionEnabled: boolean;
    selfProtectionMode: "off" | "observe" | "enforce";
    commandBlockEnabled: boolean;
    commandBlockMode: "off" | "observe" | "enforce";
    encodingGuardEnabled: boolean;
    encodingGuardMode: "off" | "observe" | "enforce";
    scriptProvenanceGuardEnabled: boolean;
    scriptProvenanceGuardMode: "off" | "observe" | "enforce";
    memoryGuardEnabled: boolean;
    memoryGuardMode: "off" | "observe" | "enforce";
    userRiskScanEnabled: boolean;
    skillScanEnabled: boolean;
    toolResultScanEnabled: boolean;
    outputRedactionEnabled: boolean;
    promptGuardEnabled: boolean;
    loopGuardEnabled: boolean;
    loopGuardMode: "off" | "observe" | "enforce";
    exfiltrationGuardEnabled: boolean;
    exfiltrationGuardMode: "off" | "observe" | "enforce";
    toolCallEnforcementEnabled: boolean;
    dispatchGuardEnabled: boolean;
    dispatchGuardMode: "off" | "observe" | "enforce";
    protectedPaths: string[];
    protectedSkills: string[];
    protectedPlugins: string[];
    startupSkillScan: boolean;
};
export type ConfigUpdateRequest = Partial<AegisConfig>;
export declare class ConfigService {
    private readonly configPath;
    private lastMtime;
    constructor(configDir: string);
    getConfigPath(): string;
    getConfigMtime(): Promise<string | null>;
    private readConfigFile;
    private writeConfigFile;
    getUserConfig(): Promise<Record<string, unknown>>;
    resolveConfig(userConfig: Record<string, unknown>): AegisConfig;
    getResolvedConfig(): Promise<AegisConfig>;
    updateConfig(update: ConfigUpdateRequest): Promise<AegisConfig>;
    resetConfig(): Promise<AegisConfig>;
}
//# sourceMappingURL=config-service.d.ts.map