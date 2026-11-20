// Authentication end to end (FR-2 to FR-7, ADR-0003): a global admin sets up MFA, invites a person to Musterdorf,
// the person registers through the emailed link, sets up MFA and accepts the invitation. Runs against the stack with
// demo data; the CI step creates the global admin with the admin CLI and passes its credentials.

import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { expectAccessible, linkFromEmail, requireEnv, setUpMfa, signIn, totp } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

const admin = {
  email: requireEnv("E2E_ADMIN_EMAIL"),
  password: requireEnv("E2E_ADMIN_PASSWORD"),
  secret: "",
};
const invited = {
  email: `e2e-${randomBytes(4).toString("hex")}@example.ch`,
  password: `e2e ${randomBytes(12).toString("hex")}`,
  secret: "",
};

test("anonymous visitors are sent to the login, and the auth pages are accessible", async ({
  page,
}) => {
  await page.goto("/backend");
  await expect(page).toHaveURL(/\/anmelden$/);
  await expectAccessible(page);
  await page.goto("/passwort-vergessen");
  await expectAccessible(page);
});

test("a wrong password is refused without revealing whether the account exists", async ({
  page,
}) => {
  await signIn(page, admin.email, "wrong password 123");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "E-Mail-Adresse oder Passwort ist falsch.",
  );
  await signIn(page, "nobody@example.ch", "wrong password 123");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "E-Mail-Adresse oder Passwort ist falsch.",
  );
});

test("the global admin must set up MFA before reaching the backend", async ({ page }) => {
  await signIn(page, admin.email, admin.password);
  await expect(page).toHaveURL(/\/mfa-einrichten$/);
  await page.goto("/backend");
  await expect(page).toHaveURL(/\/mfa-einrichten$/);
  await expectAccessible(page);
  admin.secret = await setUpMfa(page, admin.password);
  await expect(page.getByText("Sie sind Global-Admin.")).toBeVisible();
  await expectAccessible(page);
});

test("the global admin invites a person to Musterdorf", async ({ page }) => {
  await signIn(page, admin.email, admin.password);
  await expect(page).toHaveURL(/\/anmelden\/code$/);
  await page.getByLabel("Code aus der Authenticator-App").fill(await totp(admin.secret));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page).toHaveURL(/\/backend$/);

  const tenant = page.getByRole("listitem").filter({ hasText: "Musterdorf" });
  await tenant.getByText("Person einladen").click();
  await tenant.getByLabel("E-Mail-Adresse").fill(invited.email);
  await tenant.getByLabel("Rolle").selectOption("admin");
  await tenant.getByRole("button", { name: "Einladen" }).click();
  await expect(tenant.getByRole("status")).toContainText(invited.email);
});

test("the invited person registers, sets up MFA and accepts the invitation", async ({ page }) => {
  const link = await linkFromEmail(invited.email, /^Einladung zu CommuCal/);
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { name: "Konto erstellen" })).toBeVisible();
  await expect(page.getByText(invited.email)).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Ihr Name").fill("E2E Person");
  await page.getByLabel("Passwort", { exact: true }).fill(invited.password);
  await page.getByLabel("Passwort wiederholen").fill(invited.password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await expect(page).toHaveURL(/\/anmelden\?registriert=1$/);

  await signIn(page, invited.email, invited.password);
  invited.secret = await setUpMfa(page, invited.password);
  const pending = page.getByRole("region", { name: "Offene Einladungen" });
  await pending.getByRole("button", { name: /Einladung von .*Musterdorf annehmen/ }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Musterdorf" })).toContainText(
    "Administration",
  );

  // The link is used up.
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "ungültig, abgelaufen oder wurde bereits angenommen",
  );
});

test("a wrong code is refused, and signing out ends the session", async ({ page }) => {
  await signIn(page, invited.email, invited.password);
  await expect(page).toHaveURL(/\/anmelden\/code$/);
  await page.getByLabel("Code aus der Authenticator-App").fill("000000");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Der Code ist ungültig");
  await page.getByLabel("Code aus der Authenticator-App").fill(await totp(invited.secret));
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page).toHaveURL(/\/backend$/);

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL(/\/anmelden$/);
  await page.goto("/backend");
  await expect(page).toHaveURL(/\/anmelden$/);
});
