import type { Database } from "@commucal/db";
import * as schema from "@commucal/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { haveIBeenPwned, organization, twoFactor } from "better-auth/plugins";
import { accessControl, tenantRoles } from "./access.ts";

/** Emails Better Auth triggers. Implemented with Resend in production and Mailpit in development (ADR-0006). */
export interface AuthMailer {
  sendPasswordReset(message: { to: string; url: string }): Promise<void>;
  sendInvitation(message: {
    to: string;
    invitationId: string;
    tenantName: string;
    role: string;
  }): Promise<void>;
  /** Tells a user that an admin reset their MFA (FR-5). */
  sendMfaResetNotice(message: { to: string }): Promise<void>;
}

export interface CreateAuthOptions {
  /** Database connected as commucal_auth (ADR-0003). */
  db: Database;
  /** BETTER_AUTH_SECRET: signs cookies and encrypts TOTP secrets and backup codes. At least 32 characters. */
  secret: string;
  /** Public origin of the web app, e.g. https://commucal.ch. */
  baseURL: string;
  mailer: AuthMailer;
  /**
   * Reject passwords found in Have I Been Pwned (FR-6). Only the first five characters of the password's SHA-1
   * hash leave the server. Disabled only in tests, which must not depend on an external service.
   */
  checkBreachedPasswords?: boolean;
}

export const MIN_PASSWORD_LENGTH = 12;
export const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
export const PASSWORD_RESET_LIFETIME_SECONDS = 60 * 60;
export const INVITATION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/**
 * HTTP endpoints of Better Auth that CommuCal does not offer. The router answers them with 404; trusted server
 * code can still call some of them through `auth.api`.
 */
export const DISABLED_PATHS = [
  // Accounts exist only through an invitation or the global-admin CLI (FR-2, FR-8).
  "/sign-up/email",
  // Users cannot switch MFA off (FR-3); admins reset it through CommuCal code with an audit entry (FR-5).
  "/two-factor/disable",
  // Only TOTP is offered: the email OTP method would mark MFA as enabled without verifying anything.
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  // Tenants are managed by global admins in CommuCal code (FR-1); memberships end through an admin (FR-9).
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/leave",
  // Not offered; listed in case a future default enables them.
  "/delete-user",
  "/change-email",
];

const TWO_FACTOR_VERIFY_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

export function createAuth(options: CreateAuthOptions) {
  if (options.secret.length < 32) {
    throw new Error("The auth secret must be at least 32 characters long");
  }
  const baseURL = new URL(options.baseURL);

  return betterAuth({
    appName: "CommuCal",
    baseURL: baseURL.origin,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: [baseURL.origin],
    telemetry: { enabled: false },
    disabledPaths: DISABLED_PATHS,
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: {
        ...schema,
        user: schema.appUser,
        session: schema.authSession,
        account: schema.authAccount,
        verification: schema.authVerification,
        twoFactor: schema.twoFactor,
        organization: schema.tenant,
        member: schema.tenantMember,
        invitation: schema.tenantInvitation,
      },
    }),
    advanced: {
      // Ids are uuidv7() defaults of the database.
      database: { generateId: "uuid" },
      cookiePrefix: "commucal",
      useSecureCookies: baseURL.protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: 60 * 60,
      // Every request reads the session and user from the database, so a revoked session or a reset MFA takes
      // effect immediately.
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        globalAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
        twoFactorEnabledAt: { type: "date", required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_LIFETIME_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await options.mailer.sendPasswordReset({ to: user.email, url });
      },
    },
    databaseHooks: {
      user: {
        update: {
          // Records when MFA was switched on, so older sessions do not count as MFA-verified (see access.ts).
          before: async (data) => {
            if (data.twoFactorEnabled === true) {
              return { data: { ...data, twoFactorEnabledAt: new Date() } };
            }
            if (data.twoFactorEnabled === false) {
              return { data: { ...data, twoFactorEnabledAt: null } };
            }
            return { data };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // "Trust this device" would skip TOTP on later logins; MFA is required on every login (FR-3).
        const body = ctx.body as { trustDevice?: unknown } | undefined;
        if (ctx.path && TWO_FACTOR_VERIFY_PATHS.has(ctx.path) && body?.trustDevice) {
          throw new APIError("BAD_REQUEST", { message: "Trusted devices are not supported" });
        }
      }),
    },
    plugins: [
      twoFactor({
        issuer: "CommuCal",
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" },
      }),
      organization({
        ac: accessControl,
        roles: tenantRoles,
        creatorRole: "admin",
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        invitationExpiresIn: INVITATION_LIFETIME_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async ({ id, email, role, organization: tenant }) => {
          await options.mailer.sendInvitation({
            to: email,
            invitationId: id,
            tenantName: tenant.name,
            role,
          });
        },
      }),
      haveIBeenPwned({ enabled: options.checkBreachedPasswords ?? true }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
