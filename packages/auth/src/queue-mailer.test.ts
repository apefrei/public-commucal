// Emails triggered by Better Auth end up as validated jobs on the queue, with links to the web app.

import { createQueueProducer, EMAIL_QUEUE } from "@commucal/db";
import { createTestDatabase, type TestDatabase } from "@commucal/db/testing";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "./auth.ts";
import { createQueueMailer } from "./queue-mailer.ts";
import { Browser, TEST_SECRET } from "./testing/auth-harness.ts";

let db: TestDatabase;
let boss: PgBoss;

async function queuedEmails(): Promise<unknown[]> {
  const result = await db.admin.query<{ data: unknown }>(
    "select data from pgboss.job where name = $1 order by created_on",
    [EMAIL_QUEUE],
  );
  return result.rows.map((row) => row.data);
}

beforeAll(async () => {
  db = await createTestDatabase({ queues: true });
  boss = createQueueProducer(db.urlAs("commucal_app"));
  await boss.start();
}, 60_000);

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await db?.drop();
});

describe("queue mailer", () => {
  it("queues the password reset email with Better Auth's link", async () => {
    const auth = createAuth({
      db: db.as("commucal_auth"),
      secret: TEST_SECRET,
      baseURL: "http://localhost:3000",
      mailer: createQueueMailer(boss, "http://localhost:3000"),
      checkBreachedPasswords: false,
    });
    await auth.api.signUpEmail({
      body: { email: "reset@example.ch", password: "correct horse battery staple", name: "R" },
    });
    const response = await new Browser(auth).post("/request-password-reset", {
      email: "reset@example.ch",
      redirectTo: "/passwort-zuruecksetzen",
    });
    expect(response.status).toBe(200);
    expect(await queuedEmails()).toEqual([
      {
        template: "password_reset",
        to: "reset@example.ch",
        url: expect.stringMatching(
          /^http:\/\/localhost:3000\/api\/auth\/reset-password\/[\w-]+\?callbackURL=/,
        ),
      },
    ]);
  });

  it("builds invitation and MFA reset links on the web app", async () => {
    const mailer = createQueueMailer(boss, "https://commucal.ch");
    await mailer.sendInvitation({
      to: "new@example.ch",
      invitationId: "0b6c9b62-6a8e-4d4f-9b1a-2f0e5c7d8a91",
      tenantName: "Gemeinde Musterdorf",
      role: "admin",
    });
    await mailer.sendMfaResetNotice({ to: "member@example.ch" });
    const emails = await queuedEmails();
    expect(emails).toContainEqual({
      template: "invitation",
      to: "new@example.ch",
      url: "https://commucal.ch/einladung/0b6c9b62-6a8e-4d4f-9b1a-2f0e5c7d8a91",
      tenantName: "Gemeinde Musterdorf",
      role: "admin",
    });
    expect(emails).toContainEqual({
      template: "mfa_reset",
      to: "member@example.ch",
      url: "https://commucal.ch/anmelden",
    });
  });
});
