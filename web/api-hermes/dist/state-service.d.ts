/**
 * State service for Hermes adapter.
 *
 * Reads state files from the Hermes state directory.
 */
export type TrustedSkillInfo = {
    path: string;
    hash: string;
    size: number;
    scannedAt: number;
};
export type SelfIntegrityStatus = {
    valid: boolean;
    protectedRoots: string[];
    fingerprintCount: number;
    updatedAt: number;
} | null;
export type DefenseEvent = {
    timestamp: number;
    defense: string;
    mode: string;
    reason: string;
    severity: string;
    blocked: boolean;
    details?: Record<string, unknown>;
};
export declare class StateService {
    private readonly stateDir;
    constructor(stateDir: string);
    getStateDir(): string;
    isConfigured(): boolean;
    getTrustedSkillsPath(): string;
    getSelfIntegrityPath(): string;
    getDefenseEventsPath(): string;
    getSkillScanEventsPath(): string;
    getTrustedSkills(): Promise<TrustedSkillInfo[]>;
    removeTrustedSkill(skillPath: string): Promise<boolean>;
    getSelfIntegrity(): Promise<SelfIntegrityStatus>;
    getDefenseEvents(options?: {
        limit?: number;
        offset?: number;
        defense?: string;
        result?: "blocked" | "observed" | "clear";
    }): Promise<DefenseEvent[]>;
    private matchesFilter;
    countDefenseEvents(): Promise<number>;
    getSkillScanEvents(options?: {
        limit?: number;
        offset?: number;
    }): Promise<unknown[]>;
}
//# sourceMappingURL=state-service.d.ts.map