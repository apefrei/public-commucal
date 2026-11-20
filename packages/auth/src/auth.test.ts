// Authentication rules of ADR-0003 against a real PostgreSQL with the real migrations and Better Auth's real
// router. Every test tries a path that must stay closed: no backend access without MFA, no self-service sign-up,
// no way to switch MFA off or to make oneself global admin.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBackendAccess, requireBackendUser } from "./backend-access.ts";
import { type AuthHarness, Browser, createAuthHarness, totpCode } from "./testing/auth-harness.ts";

const PASSWORD = "correct horse battery staple";
let h: AuthHarness;
let counter = 0;

function uniqueEmail(): string {
  counter += 1;
  return `user${counter}@example.ch`;
}

async function createUser(
  email = uniqueEmail(),
  password = PASSWORD,
): Promise<{ id: string; email: string }> {
  const result = await h.auth.api.signUpEmail({ body: { email, password, name: "Test User" } });
  return { id: result.user.id, email };
}

async function signIn(email: string, password = PASSWORD): Promise<Browser> {
  const browser = new Browser(h.auth);
  const response = await browser.post("/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  return browser;
}

/** Runs the MFA setup flow in the browser and returns the authenticator URI and backup codes. */
async function setUpMfa(browser: Browser): Promise<{ totpURI: string; backupCodes: string[] }> {
  const enabled = await browser.post("/two-factor/enable", { password: PASSWORD });
  expect(enabled.status).toBe(200);
  const { totpURI, backupCodes } = enabled.json as { totpURI: string; backupCodes: string[] };
  const verified = await browser.post("/two-factor/verify-totp", { code: await totpCode(totpURI) });
  expect(verified.status).toBe(200);
  return { totpURI, backupCodes };
}

async function accessOf(browser: Browser) {
  return getBackendAccess(h.auth, browser.headers());
}

beforeAll(async () => {
  h = await createAuthHarness();
}, 60_000);

afterAll(async () => {
  await h?.drop();
});

describe("accounts", () => {
  it("stores users with database-generated UUIDv7 ids", async () => {
    const user = await createUser();
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("offers no public sign-up", async () => {
    const response = await new Browser(h.auth).post("/sign-up/email", {
      email: uniqueEmail(),
      password: PASSWORD,
      name: "Intruder",
    });
    expect(response.status).toBe(404);
  });

  it("rejects passwords shorter than 12 characters", async () => {
    await expect(createUser(uniqueEmail(), "short-pass1")).rejects.toThrow();
  });

  it("does not let a user make themselves global admin", async () => {
    const user = await createUser();
    const browser = await signIn(user.email);
    await browser.post("/update-user", { globalAdmin: true, name: "Still Test" });
    const result = await h.db.admin.query("select global_admin from app_user where id = $1", [
      user.id,
    ]);
    expect(result.rows[0]).toEqual({ global_admin: false });
  });

  it("offers no endpoint to create, change or delete tenants", async () => {
    const browser = await signIn((await createUser()).email);
    for (const path of ["/organization/create", "/organization/update", "/organization/delete"]) {
      expect((await browser.post(path, { name: "X", slug: "x" })).status).toBe(404);
    }
  });
});

describe("mandatory MFA (FR-3)", () => {
  it("restricts a session without MFA to the MFA setup", async () => {
    const user = await createUser();
    const browser = await signIn(user.email);
    expect(await accessOf(browser)).toEqual({ kind: "mfa_setup_required", userId: user.id });
    await expect(requireBackendUser(h.auth, browser.headers())).rejects.toMatchObject({
      reason: "mfa_setup_required",
    });
  });

  it("grants access after TOTP setup", async () => {
    const user = await createUser();
    const browser = await signIn(user.email);
    await setUpMfa(browser);
    const access = await accessOf(browser);
    expect(access.kind).toBe("granted");
    expect(await requireBackendUser(h.auth, browser.headers())).toMatchObject({
      id: user.id,
      globalAdmin: false,
    });
  });

  it("does not count a session opened before MFA setup as MFA-verified", async () => {
    const user = await createUser();
    const earlier = await signIn(user.email);
    const browser = await signIn(user.email);
    await setUpMfa(browser);
    expect((await accessOf(browser)).kind).toBe("granted");
    expect((await accessOf(earlier)).kind).toBe("mfa_setup_required");
  });

  it("does not enable MFA before a code is verified", async () => {
    const user = await createUser();
    const browser = await signIn(user.email);
    expect((await browser.post("/two-factor/enable", { password: PASSWORD })).status).toBe(200);
    expect((await browser.post("/two-factor/verify-totp", { code: "000000" })).status).not.toBe(
      200,
    );
    expect((await accessOf(browser)).kind).toBe("mfa_setup_required");
  });

  it("requires TOTP at every login once MFA is set up", async () => {
    const user = await createUser();
    const { totpURI } = await setUpMfa(await signIn(user.email));

    const browser = new Browser(h.auth);
    const login = await browser.post("/sign-in/email", { email: user.email, password: PASSWORD });
    expect(login.json).toMatchObject({ twoFactorRedirect: true });
    expect((await accessOf(browser)).kind).toBe("signed_out");

    const verified = await browser.post("/two-factor/verify-totp", {
      code: await totpCode(totpURI),
    });
    expect(verified.status).toBe(200);
    expect((await accessOf(browser)).kind).toBe("granted");
  });

  it("accepts each backup code once", async () => {
    const user = await createUser();
    const { backupCodes } = await setUpMfa(await signIn(user.email));
    const code = backupCodes[0] ?? "";

    const first = new Browser(h.auth);
    await first.post("/sign-in/email", { email: user.email, password: PASSWORD });
    expect((await first.post("/two-factor/verify-backup-code", { code })).status).toBe(200);
    expect((await accessOf(first)).kind).toBe("granted");

    const second = new Browser(h.auth);
    await second.post("/sign-in/email", { email: user.email, password: PASSWORD });
    expect((await second.post("/two-factor/verify-backup-code", { code })).status).not.toBe(200);
    expect((await accessOf(second)).kind).toBe("signed_out");
  });

  it("stores neither the TOTP secret nor the backup codes in plain text", async () => {
    const user = await createUser();
    const { totpURI, backupCodes } = await setUpMfa(await signIn(user.email));
    const secret = new URL(totpURI).searchParams.get("secret") ?? "";
    const row = await h.db.admin.query<{ secret: string; backup_codes: string }>(
      "select secret, backup_codes from two_factor where user_id = $1",
      [user.id],
    );
    const stored = JSON.stringify(row.rows[0]);
    expect(stored).not.toContain(secret);
    for (const code of backupCodes) {
      expect(stored).not.toContain(code);
    }
  });

  it("does not let users switch MFA off", async () => {
    const user = await createUser();
    const browser = await signIn(user.email);
    await setUpMfa(browser);
    expect((await browser.post("/two-factor/disable", { password: PASSWORD })).status).toBe(404);
    expect((await accessOf(browser)).kind).toBe("granted");
  });

  it("does not offer email OTP as a second factor", async () => {
    const browser = await signIn((await createUser()).email);
    expect((await browser.post("/two-factor/send-otp")).status).toBe(404);
    expect(
      (await browser.post("/two-factor/enable", { password: PASSWORD, method: "otp" })).status,
    ).not.toBe(200);
    expect((await accessOf(browser)).kind).toBe("mfa_setup_required");
  });

  it("does not remember trusted devices", async () => {
    const user = await createUser();
    const { totpURI } = await setUpMfa(await signIn(user.email));
    const browser = new Browser(h.auth);
    await browser.post("/sign-in/email", { email: user.email, password: PASSWORD });
    const response = await browser.post("/two-factor/verify-totp", {
      code: await totpCode(totpURI),
      trustDevice: true,
    });
    expect(response.status).toBe(400);
    expect((await accessOf(browser)).kind).toBe("signed_out");
  });
});

describe("password reset (FR-7)", () => {
  it("sends a single-use link, ends all sessions and keeps MFA", async () => {
    const user = await createUser();
    const browser = await signIn(user.email);
    await setUpMfa(browser);

    const anonymous = new Browser(h.auth);
    await anonymous.post("/request-password-reset", { email: user.email, redirectTo: "/reset" });
    const mail = h.mail.findLast(
      (entry) => entry.kind === "password_reset" && entry.to === user.email,
    );
    const token = new URL(mail?.url ?? "http://invalid").pathname.split("/").pop() ?? "";
    expect(token).not.toBe("");

    const newPassword = "another long passphrase";
    expect((await anonymous.post("/reset-password", { token, newPassword })).status).toBe(200);
    expect(
      (await anonymous.post("/reset-password", { token, newPassword: "yet another passphrase" }))
        .status,
    ).not.toBe(200);

    expect((await accessOf(browser)).kind).toBe("signed_out");
    const login = await new Browser(h.auth).post("/sign-in/email", {
      email: user.email,
      password: newPassword,
    });
    expect(login.json).toMatchObject({ twoFactorRedirect: true });
  });
});
