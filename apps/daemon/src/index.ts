import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { buildCore } from "./wiring.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { core, store, engine } = buildCore(cfg);

  // Maintenance pass: clean expired access, enqueue due rotations, run auto
  // rotations, prune old terminal records, auto-sync if enabled.
  const maintain = async () => {
    await core.sweepExpired();
    core.scanDueRotations();
    await core.runAutoRotations();
    core.pruneOld(Number(process.env.AGENTPASS_RETENTION_DAYS ?? 30));
    await engine.autoTick();
  };
  await maintain();
  const timer = setInterval(() => void maintain(), 30_000);
  timer.unref();

  const app = await buildServer(core, engine, cfg);
  await app.listen({ host: cfg.host, port: cfg.port });

  // Graceful shutdown: stop accepting, close the DB cleanly.
  const shutdown = async (sig: string) => {
    console.error(`agentpass daemon shutting down (${sig})`);
    clearInterval(timer);
    try {
      await app.close();
      store.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

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
