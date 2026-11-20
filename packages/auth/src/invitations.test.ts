// Invitations (FR-2): who may invite, what the link reveals, registration of invited people and acceptance through
// Better Auth after MFA setup.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessDeniedError } from "./backend-access.ts";
import {
  getOpenInvitation,
  InvitationError,
  inviteToTenant,
  listPendingInvitations,
  registerInvitedUser,
} from "./invitations.ts";
import {
  type AuthHarness,
  Browser,
  createAuthHarness,
  createTestUser,
  setUpMfa,
  TEST_PASSWORD,
} from "./testing/auth-harness.ts";

let h: AuthHarness;
const tenants = { a: "", b: "", disabled: "" };

async function insertTenant(slug: string, status = "active"): Promise<string> {
  const result = await h.db.admin.query<{ id: string }>(
    "insert into tenant (slug, name, status) values ($1, $2, $3) returning id",
    [slug, `Gemeinde ${slug}`, status],
  );
  return result.rows[0]?.id ?? "";
}

const invite = (
  actor: Awaited<ReturnType<typeof createTestUser>>,
  tenantId: string,
  email: string,
  role: "admin" | "contributor" = "contributor",
) => inviteToTenant(h.db.as("commucal_auth"), h.mailer, actor, { tenantId, email, role });

beforeAll(async () => {
  h = await createAuthHarness();
  tenants.a = await insertTenant("einladung-a");
  tenants.b = await insertTenant("einladung-b");
  tenants.disabled = await insertTenant("einladung-x", "disabled");
}, 60_000);

afterAll(async () => {
  await h?.drop();
});

describe("creating invitations", () => {
  it("lets a tenant admin invite: random id, audit entry without the email, email queued", async () => {
    const admin = await createTestUser(h, { memberships: [[tenants.a, "admin"]] });
    const id = await invite(admin, tenants.a, "New.Person@Example.ch");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const row = await h.db.admin.query(
      "select email, role, status, inviter_id, expires_at > now() + interval '6 days' as long_enough from tenant_invitation where id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({
      email: "new.person@example.ch",
      role: "contributor",
      status: "pending",
      inviter_id: admin.id,
      long_enough: true,
    });
    const audit = await h.db.admin.query(
      "select tenant_id, actor_user_id, data from audit_log where action = 'invitation.create' and entity_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([
      { tenant_id: tenants.a, actor_user_id: admin.id, data: { role: "contributor" } },
    ]);
    expect(h.mail).toContainEqual({
      kind: "invitation",
      to: "new.person@example.ch",
      invitationId: id,
    });
  });

  it("lets a global admin invite the first admin of a tenant without being a member", async () => {
    const globalAdmin = await createTestUser(h, { globalAdmin: true });
    await expect(
      invite(globalAdmin, tenants.b, "first-admin@example.ch", "admin"),
    ).resolves.toBeTruthy();
  });

  it("replaces a pending invitation for the same person and tenant", async () => {
    const admin = await createTestUser(h, { memberships: [[tenants.a, "admin"]] });
    const first = await invite(admin, tenants.a, "twice@example.ch");
    const second = await invite(admin, tenants.a, "twice@example.ch", "admin");
    const rows = await h.db.admin.query(
      "select id, status from tenant_invitation where email = 'twice@example.ch' order by created_at",
    );
    expect(rows.rows).toEqual([
      { id: first, status: "canceled" },
      { id: second, status: "pending" },
    ]);
  });

  it("refuses contributors, admins of other or disabled tenants, members and invalid input", async () => {
    const contributor = await createTestUser(h, { memberships: [[tenants.a, "contributor"]] });
    const otherAdmin = await createTestUser(h, { memberships: [[tenants.b, "admin"]] });
    const disabledAdmin = await createTestUser(h, { memberships: [[tenants.disabled, "admin"]] });
    const admin = await createTestUser(h, { memberships: [[tenants.a, "admin"]] });
    await expect(invite(contributor, tenants.a, "x1@example.ch")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(invite(otherAdmin, tenants.a, "x2@example.ch")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(invite(disabledAdmin, tenants.disabled, "x3@example.ch")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(invite(admin, tenants.a, contributor.email)).rejects.toMatchObject({
      reason: "already_member",
    });
    await expect(invite(admin, tenants.a, "not-an-email")).rejects.toThrow();
    await expect(invite(admin, "not-a-uuid", "x4@example.ch")).rejects.toThrow();
    const count = await h.db.admin.query<{ n: number }>(
      "select count(*)::int as n from tenant_invitation where email like 'x_@example.ch'",
    );
    expect(count.rows[0]?.n).toBe(0);
  });

  it("offers no Better Auth endpoint for invitations", async () => {
    const admin = await createTestUser(h, { memberships: [[tenants.a, "admin"]] });
    const response = await admin.browser.post("/organization/invite-member", {
      email: "x5@example.ch",
      role: "contributor",
      organizationId: tenants.a,
    });
    expect(response.status).toBe(404);
  });
});

describe("following the invitation link", () => {
  it("registers the invited person with the invited email; MFA setup and acceptance follow", async () => {
    const admin = await createTestUser(h, { memberships: [[tenants.a, "admin"]] });
    const id = await invite(admin, tenants.a, "invited@example.ch", "admin");

    expect(await getOpenInvitation(h.db.as("commucal_auth"), id)).toEqual({
      id,
      email: "invited@example.ch",
      tenantName: "Gemeinde einladung-a",
      role: "admin",
      accountExists: false,
    });
    await registerInvitedUser(h.db.as("commucal_auth"), h.auth, {
      invitationId: id,
      name: "Invited Person",
      password: TEST_PASSWORD,
    });
    const user = await h.db.admin.query(
      "select email_verified, two_factor_enabled, (select count(*)::int from tenant_member m where m.user_id = u.id) as memberships from app_user u where email = 'invited@example.ch'",
    );
    expect(user.rows[0]).toEqual({
      email_verified: true,
      two_factor_enabled: false,
      memberships: 0,
    });
    await expect(
      registerInvitedUser(h.db.as("commucal_auth"), h.auth, {
        invitationId: id,
        name: "Second Try",
        password: TEST_PASSWORD,
      }),
    ).rejects.toMatchObject({ reason: "account_exists" });

    // Without MFA, Better Auth refuses the acceptance (FR-3).
    const browser = new Browser(h.auth);
    await browser.post("/sign-in/email", { email: "invited@example.ch", password: TEST_PASSWORD });
    expect(
      (await browser.post("/organization/accept-invitation", { invitationId: id })).status,
    ).toBe(403);

    await setUpMfa(browser);
    const backendUser = {
      id: "",
      email: "invited@example.ch",
      name: "Invited Person",
      globalAdmin: false,
    };
    expect(await listPendingInvitations(h.db.as("commucal_auth"), backendUser)).toEqual([
      { id, tenantName: "Gemeinde einladung-a", role: "admin" },
    ]);
    expect(
      (await browser.post("/organization/accept-invitation", { invitationId: id })).status,
    ).toBe(200);

    const member = await h.db.admin.query(
      "select m.role from tenant_member m join app_user u on u.id = m.user_id where u.email = 'invited@example.ch' and m.tenant_id = $1",
      [tenants.a],
    );
    expect(member.rows).toEqual([{ role: "admin" }]);
    const audit = await h.db.admin.query(
      "select count(*)::int as n from audit_log where action = 'invitation.accept' and tenant_id = $1",
      [tenants.a],
    );
    expect(audit.rows[0]).toEqual({ n: 1 });
    expect(await getOpenInvitation(h.db.as("commucal_auth"), id)).toBeNull();
    expect(await listPendingInvitations(h.db.as("commucal_auth"), backendUser)).toEqual([]);
  });

  it("does not let another user accept the invitation", async () => {
    const admin = await createTestUser(h, { memberships: [[tenants.a, "admin"]] });
    const id = await invite(admin, tenants.a, "someone-else@example.ch");
    const intruder = await createTestUser(h);
    expect(
      (await intruder.browser.post("/organization/accept-invitation", { invitationId: id })).status,
    ).not.toBe(200);
    const members = await h.db.admin.query<{ n: number }>(
      "select count(*)::int as n from tenant_member where user_id = $1",
      [intruder.id],
    );
    expect(members.rows[0]?.n).toBe(0);
  });

  it("treats expired, unknown and malformed links as invalid", async () => {
    const admin = await createTestUser(h, { memberships: [[tenants.a, "admin"]] });
    const id = await invite(admin, tenants.a, "late@example.ch");
    await h.db.admin.query(
      "update tenant_invitation set expires_at = now() - interval '1 minute' where id = $1",
      [id],
    );
    const authDb = h.db.as("commucal_auth");
    expect(await getOpenInvitation(authDb, id)).toBeNull();
    expect(await getOpenInvitation(authDb, randomUUID())).toBeNull();
    expect(await getOpenInvitation(authDb, "not-a-uuid")).toBeNull();
    await expect(
      registerInvitedUser(authDb, h.auth, {
        invitationId: id,
        name: "Late",
        password: TEST_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InvitationError);
  });
});
