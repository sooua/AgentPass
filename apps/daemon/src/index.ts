import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { buildCore } from "./wiring.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { core } = buildCore(cfg);

  // Clean up anything left over from a previous run, then sweep periodically.
  await core.sweepExpired();
  const timer = setInterval(() => {
    void core.sweepExpired();
  }, 30_000);
  timer.unref();

  const app = await buildServer(core, cfg);
  await app.listen({ host: cfg.host, port: cfg.port });

  // token is printed once so the operator/MCP server can pick it up locally.
  console.log(
    JSON.stringify({
      msg: "agentpass daemon listening",
      url: `http://${cfg.host}:${cfg.port}`,
      token: cfg.token,
      home: cfg.home,
    }),
  );
}

main().catch((err) => {
  console.error("daemon failed to start:", err.message);
  process.exit(1);
});
