import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { secureLocalFile } from "@agentpass/shared";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { buildCore } from "./wiring.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { core, store, engine } = buildCore(cfg);

  // Publish the live connection so the desktop app can auto-connect (no manual
  // URL/token entry). Written 0600 next to the token.
  const connPath = join(cfg.home, "conn.json");
  writeFileSync(connPath, JSON.stringify({ url: `http://${cfg.host}:${cfg.port}`, token: cfg.token }), { mode: 0o600 });
  secureLocalFile(connPath); // 0600 + Windows ACL (holds the local token)

  // Maintenance pass: clean expired access, enqueue due rotations, run auto
  // rotations, prune old terminal records, auto-sync if enabled.
  // Auto-rotation is DISABLED by default: no RotationProvider can install the new
  // secret on the target yet, so auto-rotating an in-use credential (e.g. an SSH
  // key) would lock you out. Scheduled/after-reveal jobs are created and left for
  // manual mark-complete. Opt in only once a GatewayProvider applies the new
  // secret to the target. See docs/rotation-model.md.
  const autoRotate = process.env.AGENTPASS_UNSAFE_AUTO_ROTATE === "1";
  const maintain = async () => {
    await core.sweepExpired();
    core.scanDueRotations();
    if (autoRotate) await core.runAutoRotations();
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
      rmSync(connPath, { force: true }); // don't leave a stale conn.json + token
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
