import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit does NOT read .env.local — only Next does. Without this a
 * `db:migrate` falls through to the localhost fallback below and reports
 * success against a DIFFERENT database than the app is using, which then
 * fails at runtime with `column "..." does not exist`. Loading the same env
 * files Next loads, in the same order, keeps the two from diverging.
 */
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://proofjury:proofjury@localhost:54329/proofjury",
  },
});
