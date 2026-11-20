// Test helpers: a Better Auth instance on a throw-away database, an HTTP client with a cookie jar that calls the
// real router (so disabled paths, origin checks and cookies behave as in production), and a TOTP generator.

import { randomBytes } from "node:crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { createTestDatabase, type TestDatabase } from "@commucal/db/testing";
import { type Auth, type AuthMailer, createAuth } from "../auth.ts";

export const BASE_URL = "http://localhost:3000";
/** Random per test run, so no fixed secret lives in the repository. */
export const TEST_SECRET = randomBytes(32).toString("hex");

export interface SentMail {
  kind: "password_reset" | "invitation" | "mfa_reset";
  to: string;
  url?: string;
  invitationId?: string;
}

export interface AuthHarness {
  db: TestDatabase;
  auth: Auth;
  mail: SentMail[];
  mailer: AuthMailer;
  drop(): Promise<void>;
}

export async function createAuthHarness(): Promise<AuthHarness> {
  const db = await createTestDatabase();
  const mail: SentMail[] = [];
  const mailer: AuthMailer = {
    async sendPasswordReset({ to, url }) {
      mail.push({ kind: "password_reset", to, url });
    },
    async sendInvitation({ to, invitationId }) {
      mail.push({ kind: "invitation", to, invitationId });
    },
    async sendMfaResetNotice({ to }) {
      mail.push({ kind: "mfa_reset", to });
    },
  };
  const auth = createAuth({
    db: db.as("commucal_auth"),
    secret: TEST_SECRET,
    baseURL: BASE_URL,
    mailer,
    checkBreachedPasswords: false,
  });
  return { db, auth, mail, mailer, drop: () => db.drop() };
}

/** A browser: keeps cookies between requests and sends the Origin header like a same-origin form or fetch. */
export class Browser {
  readonly cookies = new Map<string, string>();
  private readonly auth: Auth;

  constructor(auth: Auth) {
    this.auth = auth;
  }

  headers(): Headers {
    const headers = new Headers({ origin: BASE_URL });
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    return headers;
  }

  async post(path: string, body: unknown = {}): Promise<{ status: number; json: unknown }> {
    const headers = this.headers();
    headers.set("content-type", "application/json");
    const response = await this.auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired || value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
    const text = await response.text();
    const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
    return { status: response.status, json: isJson && text ? (JSON.parse(text) as unknown) : text };
  }
}

/** Current TOTP code for an otpauth:// URI as an authenticator app would show it. */
export async function totpCode(totpURI: string): Promise<string> {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) {
    throw new Error("totpURI has no secret");
  }
  return createOTP(base32.decode(secret)).totp();
}
