import { Router } from "express";
import { DEFENSE_GROUPS } from "@claw-aegis-web/shared";
export function createStatusRouter(configService, stateService) {
    const router = Router();
    router.get("/", async (_req, res, next) => {
        try {
            const [config, integrity, trustedSkills, mtime] = await Promise.all([
                configService.getResolvedConfig(),
                stateService.getSelfIntegrity(),
                stateService.getTrustedSkills(),
                configService.getConfigMtime(),
            ]);
            const defenses = DEFENSE_GROUPS.map((group) => {
                const enabledKey = group.enabledKey;
                const modeKey = group.modeKey;
                return {
                    id: group.id,
                    label: group.label,
                    help: group.help,
                    enabled: Boolean(config[enabledKey]),
                    mode: modeKey ? config[modeKey] : undefined,
                };
            });
            const status = {
                defenses,
                integrity,
                trustedSkillCount: trustedSkills.length,
                configMtime: mtime,
            };
            res.json({ ok: true, data: status });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
//# sourceMappingURL=status.js.map