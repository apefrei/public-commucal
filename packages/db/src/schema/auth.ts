import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authRole } from "./roles.ts";
import { tenant } from "./tables.ts";

// Tables of Better Auth (ADR-0003). Property names are Better Auth's field names, so the Drizzle adapter maps them
// without configuration; table and column names follow our conventions. Only the auth role (commucal_auth) has
// privileges on them: app, worker and MCP never see users, sessions, password hashes or TOTP secrets. Row-level
// security with a single policy for the auth role keeps that true even if a grant is added by mistake.

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const authOnly = (name: string) =>
  pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: authRole,
    using: sql`true`,
    withCheck: sql`true`,
  });

/** Roles of a user within a tenant (requirements FR-9, ADR-0003). */
export const TENANT_ROLES = ["admin", "contributor"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** A backend user. Residents never have an account. */
export const appUser = pgTable.withRLS(
  "app_user",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    /** Set by Better Auth once a TOTP factor is verified. Without it a session only reaches MFA setup (FR-3). */
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    /**
     * When the current TOTP factor was enabled; set by packages/auth. Sessions created before it do not count as
     * MFA-verified, e.g. a second browser that logged in before MFA setup.
     */
    twoFactorEnabledAt: timestamp("two_factor_enabled_at", { withTimezone: true }),
    /** Platform operator (FR-1, FR-8). Never settable through the API; see packages/auth. */
    globalAdmin: boolean("global_admin").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Better Auth stores emails in lower case; the check keeps other writers consistent.
    check("app_user_email_lower_check", sql`${t.email} = lower(${t.email})`),
    authOnly("app_user_auth"),
  ],
);

export const authSession = pgTable.withRLS(
  "auth_session",
  {
    id: id(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    /** Tenant selected in the backend; membership is checked on every request, not trusted from here. */
    activeOrganizationId: uuid("active_tenant_id").references(() => tenant.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_session_user_idx").on(t.userId), authOnly("auth_session_auth")],
);

/** Credentials; for CommuCal only provider "credential" with a password hash. */
export const authAccount = pgTable.withRLS(
  "auth_account",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("auth_account_user_idx").on(t.userId),
    unique("auth_account_provider_unique").on(t.providerId, t.accountId),
    authOnly("auth_account_auth"),
  ],
);

/** Short-lived tokens: password reset links, two-factor login state. */
export const authVerification = pgTable.withRLS(
  "auth_verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("auth_verification_identifier_idx").on(t.identifier),
    authOnly("auth_verification_auth"),
  ],
);

/** TOTP factor and backup codes of a user; both encrypted by Better Auth with the auth secret. */
export const twoFactor = pgTable.withRLS(
  "two_factor",
  {
    id: id(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => appUser.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  () => [authOnly("two_factor_auth")],
);

/** Membership of a user in a tenant (Better Auth "member"). */
export const tenantMember = pgTable.withRLS(
  "tenant_member",
  {
    id: id(),
    organizationId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tenant_member_unique").on(t.organizationId, t.userId),
    index("tenant_member_user_idx").on(t.userId),
    check("tenant_member_role_check", sql`${t.role} in ('admin', 'contributor')`),
    authOnly("tenant_member_auth"),
  ],
);

/** Pending or answered invitation to a tenant (FR-2; Better Auth "invitation"). */
export const tenantInvitation = pgTable.withRLS(
  "tenant_invitation",
  {
    // The id is the secret in the invitation link: random UUIDv4 (122 random bits), not time-ordered UUIDv7.
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("tenant_invitation_tenant_idx").on(t.organizationId),
    index("tenant_invitation_email_idx").on(t.email),
    check("tenant_invitation_role_check", sql`${t.role} in ('admin', 'contributor')`),
    check(
      "tenant_invitation_status_check",
      sql`${t.status} in ('pending', 'accepted', 'rejected', 'canceled')`,
    ),
    authOnly("tenant_invitation_auth"),
  ],
);
