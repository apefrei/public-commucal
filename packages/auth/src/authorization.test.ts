// Tenant roles, MFA reset (FR-5), the global-admin CLI (FR-8) and the separation between the auth role and the other
// database roles.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  type BackendUser,
  getBackendAccess,
  getTenantRole,
} from "./backend-access.ts";
import { createGlobalAdmin } from "./create-global-admin.ts";
import { resetMfa } from "./mfa-reset.ts";
import { type AuthHarness, Browser, createAuthHarness, totpCode } from "./testing/auth-harness.ts";

const PASSWORD = "correct horse battery staple";
let h: AuthHarness;
const tenants = { a: "", b: "", disabled: "" };
let counter = 0;

async function insertTenant(slug: string, status = "active"): Promise<string> {
  const result = await h.db.admin.query<{ id: string }>(
    "insert into tenant (slug, name, status) values ($1, $2, $3) returning id",
    [slug, `Gemeinde ${slug}`, status],
  );
  return result.rows[0]?.id ?? "";
}

/** Creates a user with MFA set up, optionally as member of tenants. Returns the user as the backend sees it. */
async function createMfaUser(
  memberships: Array<[string, "admin" | "contributor"]> = [],
  globalAdmin = false,
): Promise<BackendUser & { browser: Browser }> {
  counter += 1;
  const email = `member${counter}@example.ch`;
  const { user } = await h.auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: "Member" },
  });
  for (const [tenantId, role] of memberships) {
    await h.db.admin.query(
      "insert into tenant_member (tenant_id, user_id, role) values ($1, $2, $3)",
      [tenantId, user.id, role],
    );
  }
  if (globalAdmin) {
    await h.db.admin.query("update app_user set global_admin = true where id = $1", [user.id]);
  }
  const browser = new Browser(h.auth);
  await browser.post("/sign-in/email", { email, password: PASSWORD });
  const enabled = await browser.post("/two-factor/enable", { password: PASSWORD });
  const { totpURI } = enabled.json as { totpURI: string };
  await browser.post("/two-factor/verify-totp", { code: await totpCode(totpURI) });
  return { id: user.id, email, name: "Member", globalAdmin, browser };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeAll(async () => {
  h = await createAuthHarness();
  tenants.a = await insertTenant("gemeinde-a");
  tenants.b = await insertTenant("gemeinde-b");
  tenants.disabled = await insertTenant("gemeinde-x", "disabled");
}, 60_000);

afterAll(async () => {
  await h?.drop();
});

describe("tenant roles", () => {
  it("returns the role of a member and nothing for other tenants", async () => {
    const user = await createMfaUser([[tenants.a, "contributor"]]);
    const authDb = h.db.as("commucal_auth");
    expect(await getTenantRole(authDb, user, tenants.a)).toBe("contributor");
    expect(await getTenantRole(authDb, user, tenants.b)).toBeNull();
    expect(await getTenantRole(authDb, user, "not-a-uuid")).toBeNull();
  });

  it("denies members of a disabled tenant", async () => {
    const user = await createMfaUser([[tenants.disabled, "admin"]]);
    expect(await getTenantRole(h.db.as("commucal_auth"), user, tenants.disabled)).toBeNull();
  });

  it("treats global admins as admin of every tenant", async () => {
    const admin = await createMfaUser([], true);
    expect(await getTenantRole(h.db.as("commucal_auth"), admin, tenants.b)).toBe("admin");
  });
});

describe("MFA reset (FR-5)", () => {
  const reset = (actor: BackendUser, targetUserId: string, tenantId: string | null) =>
    resetMfa(h.db.as("commucal_auth"), h.mailer, { actor, targetUserId, tenantId });

  it("lets a tenant admin reset a member: factor removed, sessions ended, audited, user notified", async () => {
    const admin = await createMfaUser([[tenants.a, "admin"]]);
    const member = await createMfaUser([[tenants.a, "contributor"]]);

    await reset(admin, member.id, tenants.a);

    const state = await h.db.admin.query(
      `select u.two_factor_enabled, u.two_factor_enabled_at,
              (select count(*)::int from two_factor where user_id = u.id) as factors,
              (select count(*)::int from auth_session where user_id = u.id) as sessions
         from app_user u where u.id = $1`,
      [member.id],
    );
    expect(state.rows[0]).toEqual({
      two_factor_enabled: false,
      two_factor_enabled_at: null,
      factors: 0,
      sessions: 0,
    });
    const audit = await h.db.admin.query(
      "select tenant_id, actor_user_id, action, entity_id from audit_log where action = 'user.mfa_reset' and entity_id = $1",
      [member.id],
    );
    expect(audit.rows).toEqual([
      {
        tenant_id: tenants.a,
        actor_user_id: admin.id,
        action: "user.mfa_reset",
        entity_id: member.id,
      },
    ]);
    expect(h.mail).toContainEqual({ kind: "mfa_reset", to: member.email });

    // At the next login the user gets a full session again, but only for the MFA setup.
    const browser = new Browser(h.auth);
    const login = await browser.post("/sign-in/email", { email: member.email, password: PASSWORD });
    expect(login.json).not.toMatchObject({ twoFactorRedirect: true });
    const session = await h.auth.api.getSession({ headers: browser.headers() });
    expect(session?.user.twoFactorEnabled).toBe(false);
  });

  it("denies a tenant admin for users of another tenant, for global admins and for contributors", async () => {
    const admin = await createMfaUser([[tenants.a, "admin"]]);
    const contributor = await createMfaUser([[tenants.a, "contributor"]]);
    const otherTenantUser = await createMfaUser([[tenants.b, "contributor"]]);
    const globalAdmin = await createMfaUser([[tenants.a, "contributor"]], true);

    await expect(reset(admin, otherTenantUser.id, tenants.a)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(reset(admin, otherTenantUser.id, tenants.b)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(reset(admin, globalAdmin.id, tenants.a)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(reset(contributor, admin.id, tenants.a)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(reset(admin, admin.id, tenants.a)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(reset(admin, contributor.id, null)).rejects.toBeInstanceOf(AccessDeniedError);

    const factors = await h.db.admin.query<{ n: number }>(
      "select count(*)::int as n from two_factor where user_id = any($1::uuid[])",
      [[otherTenantUser.id, globalAdmin.id, admin.id]],
    );
    expect(factors.rows[0]?.n).toBe(3);
  });

  it("lets a global admin reset any user; without a tenant the entry goes to the platform chain", async () => {
    const globalAdmin = await createMfaUser([], true);
    const otherAdmin = await createMfaUser([], true);
    await reset(globalAdmin, otherAdmin.id, null);
    const audit = await h.db.admin.query(
      "select tenant_id from audit_log where action = 'user.mfa_reset' and entity_id = $1",
      [otherAdmin.id],
    );
    expect(audit.rows).toEqual([{ tenant_id: null }]);
  });
});

describe("database role separation", () => {
  it("keeps the auth role away from calendars, events and the audit log contents", async () => {
    const pool = h.db.poolAs("commucal_auth");
    expect(await errorCode(pool.query("select * from calendar"))).toBe("42501");
    expect(await errorCode(pool.query("select * from event"))).toBe("42501");
    expect(await errorCode(pool.query("select * from audit_log"))).toBe("42501");
    expect(
      await errorCode(pool.query("update tenant set name = 'hijacked' where slug = 'gemeinde-a'")),
    ).toBe("42501");
    expect(
      await errorCode(pool.query("insert into tenant (slug, name) values ('evil', 'Evil')")),
    ).toBe("42501");
  });

  it("keeps app, worker and MCP away from users, credentials, sessions and TOTP secrets", async () => {
    for (const role of ["commucal_app", "commucal_worker", "commucal_mcp"] as const) {
      const pool = h.db.poolAs(role);
      for (const table of [
        "app_user",
        "auth_account",
        "auth_session",
        "auth_verification",
        "two_factor",
        "tenant_member",
        "tenant_invitation",
      ]) {
        expect(await errorCode(pool.query(`select * from ${table}`)), `${role} on ${table}`).toBe(
          "42501",
        );
      }
    }
  });

  it("lets the auth role read tenants for membership lookups", async () => {
    const rows = await h.db
      .poolAs("commucal_auth")
      .query<{ n: number }>("select count(*)::int as n from tenant");
    expect(rows.rows[0]?.n).toBe(3);
  });
});

describe("global-admin CLI (FR-8)", () => {
  it("creates a global admin with an audit entry, who still has to set up MFA", async () => {
    const id = await createGlobalAdmin(h.db.as("commucal_auth"), h.auth, {
      email: "Ops@Example.ch",
      name: "Ops",
      password: PASSWORD,
    });
    const user = await h.db.admin.query(
      "select email, global_admin, two_factor_enabled from app_user where id = $1",
      [id],
    );
    expect(user.rows[0]).toEqual({
      email: "ops@example.ch",
      global_admin: true,
      two_factor_enabled: false,
    });
    const audit = await h.db.admin.query(
      "select tenant_id, actor_label from audit_log where action = 'user.global_admin_created' and entity_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([{ tenant_id: null, actor_label: "cli:create-global-admin" }]);

    const browser = new Browser(h.auth);
    await browser.post("/sign-in/email", { email: "ops@example.ch", password: PASSWORD });
    expect((await getBackendAccess(h.auth, browser.headers())).kind).toBe("mfa_setup_required");
  });

  it("refuses an existing email, an invalid email and a short password", async () => {
    const create = (email: string, password = PASSWORD) =>
      createGlobalAdmin(h.db.as("commucal_auth"), h.auth, { email, name: "Ops", password });
    await create("second-ops@example.ch");
    await expect(create("second-ops@example.ch")).rejects.toThrow("already exists");
    await expect(create("not-an-email")).rejects.toThrow();
    await expect(create("third-ops@example.ch", "too-short")).rejects.toThrow();
    const count = await h.db.admin.query<{ n: number }>(
      "select count(*)::int as n from app_user where email = 'third-ops@example.ch'",
    );
    expect(count.rows[0]?.n).toBe(0);
  });
});
