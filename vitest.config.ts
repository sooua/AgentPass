import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Run tests against package source (no build step needed).
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@agentpass/shared": pkg("shared"),
      "@agentpass/core": pkg("core"),
      "@agentpass/storage-sqlite": pkg("storage-sqlite"),
      "@agentpass/credential-providers": pkg("credential-providers"),
      "@agentpass/checkout-providers": pkg("checkout-providers"),
      "@agentpass/rotation-providers": pkg("rotation-providers"),
      "@agentpass/gateway-adapters": pkg("gateway-adapters"),
    },
  },
  // node:sqlite is a newer builtin Vite doesn't externalize by default.
  ssr: { external: ["node:sqlite"] },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    server: { deps: { external: [/node:sqlite/] } },
  },
});
