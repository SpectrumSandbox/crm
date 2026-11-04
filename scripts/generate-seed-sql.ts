/**
 * Emits drizzle/seed.sql from src/lib/seed.ts so D1 holds exactly the data the UI ships with.
 *   npm run db:seed-sql && npm run db:seed:remote
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildSeedStatements } from "../src/lib/seed-sql";

const out = buildSeedStatements();
const file = resolve(process.cwd(), "drizzle/seed.sql");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, out.join("\n") + "\n");
console.log(`wrote ${out.length} statements → ${file}`);
