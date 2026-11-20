import "server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  VALKEY_URL: z.string().min(1).default("redis://valkey:6379"),
});

export type ServerEnv = z.infer<typeof envSchema>;

/** Reads the environment at runtime (never at build time) and fails with the names of missing variables. */
export function readServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment: ${names}`);
  }
  return result.data;
}
