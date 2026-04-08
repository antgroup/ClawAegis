import { createServer } from "./server.js";

const port = parseInt(process.env.AEGIS_PORT ?? "3800", 10);
const configDir = process.env.AEGIS_CONFIG_DIR ?? process.cwd();
const stateDir = process.env.AEGIS_STATE_DIR ?? "";

for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split("=");
  if (key === "--port" && value) Object.assign(process.env, { AEGIS_PORT: value });
  if (key === "--config-dir" && value) Object.assign(process.env, { AEGIS_CONFIG_DIR: value });
  if (key === "--state-dir" && value) Object.assign(process.env, { AEGIS_STATE_DIR: value });
}

const finalPort = parseInt(process.env.AEGIS_PORT ?? String(port), 10);
const finalConfigDir = process.env.AEGIS_CONFIG_DIR ?? configDir;
const finalStateDir = process.env.AEGIS_STATE_DIR ?? stateDir;

const app = createServer({ configDir: finalConfigDir, stateDir: finalStateDir });

app.listen(finalPort, () => {
  console.log(`[claw-aegis-web] API server listening on http://localhost:${finalPort}`);
  if (finalStateDir) {
    console.log(`[claw-aegis-web] State dir: ${finalStateDir}`);
  }
  console.log(`[claw-aegis-web] Config dir: ${finalConfigDir}`);
});
