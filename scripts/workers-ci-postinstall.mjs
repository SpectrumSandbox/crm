// Cloudflare Workers Builds ignores wrangler's custom `build` command, and its default pipeline is
// `npm install` → (optional build command) → `npx wrangler deploy`. When running there (WORKERS_CI=1),
// build the OpenNext bundle right after install so the default deploy command finds .open-next/worker.js.
// Local installs and GitHub Actions are unaffected.
import { spawnSync } from "node:child_process";

if (process.env.WORKERS_CI !== "1") process.exit(0);
console.log("[workers-ci] Workers Builds detected — running opennextjs-cloudflare build");
const r = spawnSync("npx", ["opennextjs-cloudflare", "build"], { stdio: "inherit" });
process.exit(r.status ?? 1);
