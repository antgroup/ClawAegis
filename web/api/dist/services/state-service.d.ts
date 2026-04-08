import type { TrustedSkillInfo, SelfIntegrityStatus } from "@claw-aegis-web/shared";
export declare class StateService {
    private readonly stateDir;
    constructor(stateDir: string);
    getStateDir(): string;
    isConfigured(): boolean;
    getTrustedSkillsPath(): string;
    getSelfIntegrityPath(): string;
    getTrustedSkills(): Promise<TrustedSkillInfo[]>;
    removeTrustedSkill(skillPath: string): Promise<boolean>;
    getSelfIntegrity(): Promise<SelfIntegrityStatus>;
}
//# sourceMappingURL=state-service.d.ts.map