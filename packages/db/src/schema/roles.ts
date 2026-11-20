import { pgRole } from "drizzle-orm/pg-core";

// Runtime database roles (ADR-0004). They are created in the first migration and get their passwords from the
// migrate container; drizzle-kit only references them.
export const appRole = pgRole("commucal_app").existing();
export const workerRole = pgRole("commucal_worker").existing();
export const mcpRole = pgRole("commucal_mcp").existing();
