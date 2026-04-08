import { Router } from "express";
export function createSkillsRouter(stateService, eventService) {
    const router = Router();
    router.get("/", async (_req, res, next) => {
        try {
            const trustedSkills = await stateService.getTrustedSkills();
            res.json({
                ok: true,
                data: { trustedSkills, total: trustedSkills.length },
            });
        }
        catch (err) {
            next(err);
        }
    });
    router.delete("/:path(*)", async (req, res, next) => {
        try {
            const skillPath = decodeURIComponent(req.params["path(*)"] ?? req.params.path ?? "");
            const removed = await stateService.removeTrustedSkill(skillPath);
            if (removed) {
                eventService.addEvent({
                    timestamp: Date.now(),
                    defense: "skillScan",
                    result: "clear",
                    reason: `Trusted skill removed: ${skillPath}`,
                });
            }
            res.json({ ok: true, data: { removed } });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
//# sourceMappingURL=skills.js.map