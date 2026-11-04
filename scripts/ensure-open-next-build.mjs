// Runs `opennextjs-cloudflare build` unless .open-next/worker.js already exists.
// Wired as wrangler's custom build so `wrangler deploy` works with or without a separate build step.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (existsSync(".open-next/worker.js") && !process.env.FORCE_OPEN_NEXT_BUILD) {
  console.log("[ensure-open-next-build] .open-next/worker.js present — skipping build");
  process.exit(0);
}
console.log("[ensure-open-next-build] building Next.js app for Cloudflare (opennextjs-cloudflare build)…");
const r = spawnSync("npx", ["opennextjs-cloudflare", "build"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
