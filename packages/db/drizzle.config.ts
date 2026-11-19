import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from src/schema (ADR-0004). Roles, functions and grants are hand-written custom
// migrations in the same folder, because drizzle-kit does not manage them.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  entities: { roles: false },
});
