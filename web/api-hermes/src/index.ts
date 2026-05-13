import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default paths for Hermes
const hermesHome = path.join(process.env.HOME || "/tmp", ".hermes");
const defaultConfigDir = path.join(hermesHome, "plugins", "claw-aegis");
const defaultStateDir = path.join(hermesHome, "claw-aegis-state");
const defaultRpcServerPath = path.join(
  __dirname,
  "../../../../rpc-server.js"
);
const defaultStaticDir = path.join(
  __dirname,
  "../../frontend/dist"
);

// Parse environment variables
const port = parseInt(process.env.AEGIS_PORT ?? "3800", 10);
const configDir = process.env.AEGIS_CONFIG_DIR ?? defaultConfigDir;
const stateDir = process.env.AEGIS_STATE_DIR ?? defaultStateDir;
const rpcServerPath = process.env.AEGIS_RPC_SERVER_PATH ?? defaultRpcServerPath;
const staticDir = process.env.AEGIS_STATIC_DIR ?? defaultStaticDir;

// Parse command line arguments
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split("=");
  if (key === "--port" && value)
    Object.assign(process.env, { AEGIS_PORT: value });
  if (key === "--config-dir" && value)
    Object.assign(process.env, { AEGIS_CONFIG_DIR: value });
  if (key === "--state-dir" && value)
    Object.assign(process.env, { AEGIS_STATE_DIR: value });
  if (key === "--rpc-server" && value)
    Object.assign(process.env, { AEGIS_RPC_SERVER_PATH: value });
  if (key === "--static-dir" && value)
    Object.assign(process.env, { AEGIS_STATIC_DIR: value });
  if (key === "--no-frontend")
    Object.assign(process.env, { AEGIS_STATIC_DIR: "" });
}

const finalPort = parseInt(process.env.AEGIS_PORT ?? String(port), 10);
const finalConfigDir = process.env.AEGIS_CONFIG_DIR ?? configDir;
const finalStateDir = process.env.AEGIS_STATE_DIR ?? stateDir;
const finalRpcServerPath = process.env.AEGIS_RPC_SERVER_PATH ?? rpcServerPath;
const finalStaticDir = process.env.AEGIS_STATIC_DIR ?? staticDir;

// Create server
const { app, cleanup } = createServer({
  port: finalPort,
  configDir: finalConfigDir,
  stateDir: finalStateDir,
  rpcServerPath: finalRpcServerPath,
  staticDir: finalStaticDir || undefined,
});

// Start server
const server = app.listen(finalPort, () => {
  console.log(`[aegis-web] Hermes Web API server listening on http://localhost:${finalPort}`);
  console.log(`[aegis-web] Config dir: ${finalConfigDir}`);
  console.log(`[aegis-web] State dir: ${finalStateDir}`);
  console.log(`[aegis-web] RPC server: ${finalRpcServerPath}`);
  if (finalStaticDir) {
    console.log(`[aegis-web] Static dir: ${finalStaticDir}`);
  } else {
    console.log(`[aegis-web] Frontend serving disabled`);
  }
  console.log(`[aegis-web] Health check: http://localhost:${finalPort}/api/v1/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  cleanup();
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  cleanup();
  server.close(() => {
    process.exit(0);
  });
});

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error("[aegis-web] Uncaught exception:", err);
  cleanup();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[aegis-web] Unhandled rejection:", reason);
});
