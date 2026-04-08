import type { AegisConfig, ConfigUpdateRequest } from "@claw-aegis-web/shared";
export declare class ConfigService {
    private readonly pluginJsonPath;
    private lastMtime;
    constructor(configDir: string);
    getPluginJsonPath(): string;
    getConfigMtime(): Promise<string | null>;
    private readPluginJson;
    private writePluginJson;
    getUserConfig(): Promise<Record<string, unknown>>;
    resolveConfig(userConfig: Record<string, unknown>): AegisConfig;
    getResolvedConfig(): Promise<AegisConfig>;
    updateConfig(update: ConfigUpdateRequest): Promise<AegisConfig>;
    resetConfig(): Promise<AegisConfig>;
}
//# sourceMappingURL=config-service.d.ts.map