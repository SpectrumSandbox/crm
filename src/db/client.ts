import { drizzle } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

/** Drizzle client bound to the `DB` D1 binding (server-side only). */
export async function getDb() {
  const { env } = await getCloudflareContext({ async: true });
  // The binding object is the real D1Database at runtime; our ambient type is a structural subset.
  return drizzle(env.DB as never, { schema });
}

export { schema };
