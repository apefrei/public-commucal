import AxeBuilder from "@axe-core/playwright";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { expect, type Page } from "@playwright/test";

export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** Current code for a base32 TOTP secret, as an authenticator app would show it. */
export function totp(secret: string): Promise<string> {
  return createOTP(base32.decode(secret.replace(/\s+/g, ""))).totp();
}

/** No WCAG 2.1 A/AA violations on the current page (NFR-17). */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

interface MailpitMessage {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
}

/** Waits for the newest email to an address and returns the first https link in its text. */
export async function linkFromEmail(to: string, subject: RegExp): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as {
      messages: MailpitMessage[];
    };
    const message = list.messages.find(
      (candidate) =>
        candidate.To.some((recipient) => recipient.Address === to) &&
        subject.test(candidate.Subject),
    );
    if (message) {
      const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as {
        Text: string;
      };
      const link = /https:\/\/\S+/.exec(full.Text)?.[0];
      if (link) {
        return link;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No email "${subject}" to ${to}`);
}

/** Runs the MFA setup page and returns the TOTP secret. */
export async function setUpMfa(page: Page, password: string): Promise<string> {
  await expect(page).toHaveURL(/\/mfa-einrichten$/);
  await page.getByLabel("Passwort bestätigen").fill(password);
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByRole("img", { name: "QR-Code für die Authenticator-App" })).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").textContent()) ?? "";
  await page.getByLabel("Ich habe die Backup-Codes sicher aufbewahrt.").check();
  await page.getByLabel("Code aus der Authenticator-App").fill(await totp(secret));
  await page.getByRole("button", { name: "Einrichtung abschliessen" }).click();
  await expect(page).toHaveURL(/\/backend$/);
  return secret;
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/anmelden");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
}
