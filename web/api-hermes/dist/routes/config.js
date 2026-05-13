import { Router } from "express";
// Default configuration values (same as CONFIG_DEFAULTS in shared package)
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
export function createConfigRouter(configService, rpcClient) {
    const router = Router();
    // GET /api/v1/config - Get current configuration
    router.get("/", async (_req, res, next) => {
        try {
            // Try to get config from RPC runtime first (if available and ready)
            if (rpcClient?.isReady()) {
                const runtimeConfig = await rpcClient.getConfig();
                res.json({
                    ok: true,
                    data: { config: runtimeConfig, defaults: CONFIG_DEFAULTS },
                });
                return;
            }
            // Fall back to reading from config file
            const config = await configService.getResolvedConfig();
            res.json({ ok: true, data: { config, defaults: CONFIG_DEFAULTS } });
        }
        catch (err) {
            next(err);
        }
    });
    // PUT /api/v1/config - Update configuration
    router.put("/", async (req, res, next) => {
        try {
            const update = req.body;
            const config = await configService.updateConfig(update);
            // If RPC client is connected, reinitialize with new config
            if (rpcClient?.isReady()) {
                try {
                    // Note: The RPC runtime doesn't support hot-reloading config
                    // A restart of the Hermes plugin would be needed for full sync
                    console.log("[aegis-web] Config updated. Note: A Hermes plugin restart may be needed for all changes to take effect.");
                }
                catch {
                    // Ignore RPC errors - file config is the source of truth
                }
            }
            res.json({ ok: true, data: { config, defaults: CONFIG_DEFAULTS } });
        }
        catch (err) {
            next(err);
        }
    });
    // POST /api/v1/config/reset - Reset to default configuration
    router.post("/reset", async (_req, res, next) => {
        try {
            const config = await configService.resetConfig();
            res.json({ ok: true, data: { config, defaults: CONFIG_DEFAULTS } });
        }
        catch (err) {
            next(err);
        }
    });
    // GET /api/v1/config/path - Get config file path (for debugging)
    router.get("/path", (_req, res) => {
        res.json({ ok: true, data: { path: configService.getConfigPath() } });
    });
    return router;
}
//# sourceMappingURL=config.js.map