import express from "express";
import cors from "cors";
import path from "node:path";
import { createConfigRouter } from "./routes/config.js";
import { createStatusRouter } from "./routes/status.js";
import { createEventsRouter } from "./routes/events.js";
import { createSkillsRouter } from "./routes/skills.js";
import { ConfigService } from "./config-service.js";
import { StateService } from "./state-service.js";
import { AegisRpcClient } from "./rpc-client.js";
const API_PREFIX = "/api/v1";
export function createServer(options) {
    const app = express();
    app.use(cors());
    app.use(express.json());
    // Create services
    const configService = new ConfigService(options.configDir);
    const stateService = new StateService(options.stateDir);
    // Create RPC client (optional - can work without it for config-only mode)
    const rpcClient = new AegisRpcClient(options.rpcServerPath);
    // Start RPC client and initialize
    let rpcInitialized = false;
    async function initRpc() {
        try {
            rpcClient.start();
            // Wait a bit for the process to start
            await new Promise((resolve) => setTimeout(resolve, 500));
            // Load config and initialize RPC runtime
            const config = await configService.getUserConfig();
            const hermesHome = path.join(process.env.HOME || "/tmp", ".hermes");
            await rpcClient.init({
                config,
                stateDir: options.stateDir,
                pluginRootDir: path.resolve(options.configDir, "..", ".."),
                skillRoots: [path.join(hermesHome, "skills")],
                protectedRoots: [
                    path.join(hermesHome, "plugins", "claw-aegis"),
                    hermesHome,
                    path.join(hermesHome, ".env"),
                    path.join(hermesHome, "config.yaml"),
                    path.join(hermesHome, "plugins"),
                    path.join(hermesHome, "skills"),
                ],
            });
            rpcInitialized = true;
            console.log("[aegis-web] RPC client initialized successfully");
        }
        catch (err) {
            console.error("[aegis-web] RPC initialization failed:", err instanceof Error ? err.message : String(err));
            console.log("[aegis-web] Running in config-only mode (no real-time data)");
        }
    }
    // Initialize RPC in background
    initRpc().catch(() => {
        // Error already logged
    });
    // Routes
    app.use(`${API_PREFIX}/config`, createConfigRouter(configService, rpcClient));
    app.use(`${API_PREFIX}/status`, createStatusRouter(configService, stateService, rpcClient));
    app.use(`${API_PREFIX}/events`, createEventsRouter(stateService));
    const skillsRouter = createSkillsRouter(stateService, rpcClient);
    app.use(`${API_PREFIX}/skills`, skillsRouter);
    // Alias /skill-scans to /skills/scan-events for frontend compatibility
    app.use(`${API_PREFIX}/skill-scans`, (req, res, next) => {
        req.url = "/scan-events" + req.url.replace(/\/?$/, "");
        skillsRouter(req, res, next);
    });
    // Health check
    app.get(`${API_PREFIX}/health`, (_req, res) => {
        res.json({
            status: "ok",
            version: "0.1.0-hermes",
            rpc: {
                connected: rpcClient.isReady(),
                initialized: rpcInitialized,
            },
        });
    });
    // RPC status endpoint
    app.get(`${API_PREFIX}/rpc/status`, (_req, res) => {
        res.json({
            ok: true,
            data: {
                connected: rpcClient.isReady(),
                initialized: rpcInitialized,
            },
        });
    });
    // Serve frontend static files in production
    if (options.staticDir) {
        const frontendDist = path.resolve(options.staticDir);
        app.use(express.static(frontendDist));
        app.get("*", (_req, res, next) => {
            if (_req.path.startsWith(API_PREFIX))
                return next();
            res.sendFile(path.join(frontendDist, "index.html"), (err) => {
                if (err)
                    next();
            });
        });
    }
    // Error handler
    app.use((err, _req, res, _next) => {
        console.error("[aegis-web] Error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    });
    // Cleanup function
    const cleanup = () => {
        console.log("[aegis-web] Shutting down...");
        rpcClient.stop();
    };
    return { app, cleanup, rpcClient };
}
//# sourceMappingURL=server.js.map