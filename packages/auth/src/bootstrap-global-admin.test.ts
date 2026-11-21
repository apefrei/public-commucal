// First global admin from GLOBAL_ADMIN_EMAIL (FR-8): created once, without a known password, with a setup link.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBackendAccess } from "./backend-access.ts";
import {
  BOOTSTRAP_ACTOR_LABEL,
  DEFAULT_GLOBAL_ADMIN_NAME,
  ensureGlobalAdmin,
} from "./bootstrap-global-admin.ts";
import {
  type AuthHarness,
  Browser,
  createAuthHarness,
  createTestUser,
  TEST_PASSWORD,
} from "./testing/auth-harness.ts";

let h: AuthHarness;

beforeAll(async () => {
  h = await createAuthHarness();
}, 60_000);

afterAll(async () => {
  await h?.drop();
});

const ensure = (email: string, name?: string) =>
  ensureGlobalAdmin(h.db.as("commucal_auth"), h.auth, name ? { email, name } : { email });

const setupMails = (to: string) =>
  h.mail.filter((entry) => entry.kind === "password_reset" && entry.to === to);

describe("global admin from GLOBAL_ADMIN_EMAIL (FR-8)", () => {
  it("creates the account once, with an audit entry and a setup link that sets the password", async () => {
    expect(await ensure("Boot@Example.ch")).toBe("created");
    const user = await h.db.admin.query(
      "select id, name, global_admin, email_verified, two_factor_enabled from app_user where email = 'boot@example.ch'",
    );
    expect(user.rows[0]).toMatchObject({
      name: DEFAULT_GLOBAL_ADMIN_NAME,
      global_admin: true,
      email_verified: true,
      two_factor_enabled: false,
    });
    const audit = await h.db.admin.query(
      "select actor_label from audit_log where action = 'user.global_admin_created' and entity_id = $1",
      [user.rows[0]?.id],
    );
    expect(audit.rows).toEqual([{ actor_label: BOOTSTRAP_ACTOR_LABEL }]);

    // Restarting the stack changes nothing and sends no further email.
    expect(await ensure("boot@example.ch", "Another Name")).toBe("exists");
    const mails = setupMails("boot@example.ch");
    expect(mails).toHaveLength(1);

    const url = new URL(mails[0]?.url ?? "http://invalid");
    expect(url.searchParams.get("callbackURL")).toBe("/passwort-zuruecksetzen");
    const token = url.pathname.split("/").pop() ?? "";
    const anonymous = new Browser(h.auth);
    expect(
      (await anonymous.post("/reset-password", { token, newPassword: TEST_PASSWORD })).status,
    ).toBe(200);
    const browser = new Browser(h.auth);
    await browser.post("/sign-in/email", { email: "boot@example.ch", password: TEST_PASSWORD });
    expect((await getBackendAccess(h.auth, browser.headers())).kind).toBe("mfa_setup_required");
  });

  it("uses the configured name", async () => {
    await ensure("named-boot@example.ch", "  Ops Team ");
    const user = await h.db.admin.query(
      "select name from app_user where email = 'named-boot@example.ch'",
    );
    expect(user.rows[0]).toEqual({ name: "Ops Team" });
  });

  it("refuses to promote an existing account and rejects an invalid email", async () => {
    const member = await createTestUser(h);
    await expect(ensure(member.email)).rejects.toThrow("not a global admin");
    const row = await h.db.admin.query("select global_admin from app_user where id = $1", [
      member.id,
    ]);
    expect(row.rows[0]).toEqual({ global_admin: false });
    expect(setupMails(member.email)).toHaveLength(0);
    await expect(ensure("not-an-email")).rejects.toThrow();
  });
});
