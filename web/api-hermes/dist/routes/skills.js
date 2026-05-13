import { Router } from "express";
export function createSkillsRouter(stateService, rpcClient) {
    const router = Router();
    // GET /api/v1/skills - Get trusted skills list
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
    // DELETE /api/v1/skills/:path - Remove a trusted skill
    router.delete("/:path(*)", async (req, res, next) => {
        try {
            // Handle wildcard path parameter
            const skillPath = decodeURIComponent(req.params["path(*)"] ??
                req.params.path ??
                "");
            if (!skillPath) {
                res.status(400).json({ ok: false, error: "Missing skill path" });
                return;
            }
            const removed = await stateService.removeTrustedSkill(skillPath);
            if (removed) {
                res.json({ ok: true, data: { removed: true } });
            }
            else {
                res.status(404).json({ ok: false, error: "Skill not found" });
            }
        }
        catch (err) {
            next(err);
        }
    });
    // POST /api/v1/skills/scan - Trigger skill scan
    router.post("/scan", async (req, res, next) => {
        try {
            if (!rpcClient?.isReady()) {
                res.status(503).json({
                    ok: false,
                    error: "RPC client not connected. Cannot trigger scan.",
                });
                return;
            }
            const roots = req.body.roots;
            if (!roots || !Array.isArray(roots) || roots.length === 0) {
                res.status(400).json({
                    ok: false,
                    error: "Missing or invalid 'roots' parameter",
                });
                return;
            }
            const result = await rpcClient.scanSkills({ roots });
            res.json({
                ok: true,
                data: result,
            });
        }
        catch (err) {
            next(err);
        }
    });
    // GET /api/v1/skills/state-path - Get path to trusted skills file
    router.get("/state-path", (_req, res) => {
        res.json({
            ok: true,
            data: {
                path: stateService.getTrustedSkillsPath(),
            },
        });
    });
    // GET /api/v1/skills/scan-events - Get skill scan events
    router.get("/scan-events", async (req, res, next) => {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const offset = parseInt(req.query.offset) || 0;
            const events = await stateService.getSkillScanEvents({ limit, offset });
            res.json({
                ok: true,
                data: { events, total: events.length },
            });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
//# sourceMappingURL=skills.js.map