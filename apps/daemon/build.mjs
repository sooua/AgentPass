// Bundles the daemon into a single .mjs that the desktop app ships as a Tauri
// resource and spawns with the system `node`. Everything is inlined except Node
// builtins (node:sqlite in particular — a builtin, not a native addon, which is
// why a plain bundle is enough and no per-platform binary is needed).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

await build({
  entryPoints: [join(here, "dist/index.js")],
  outfile: join(here, "../desktop/src-tauri/resources/daemon.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  define: { __AGENTPASS_VERSION__: JSON.stringify(version) },
  // ESM output still needs a `require` for the CJS deps esbuild leaves alone.
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});

console.log(`bundled daemon ${version} -> apps/desktop/src-tauri/resources/daemon.mjs`);
