import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: "3e0b5192-7ade-44d3-b9d6-2ae0b9a383df",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
});
