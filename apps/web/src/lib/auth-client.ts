import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser client for Better Auth's endpoints under /api/auth (same origin). */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), organizationClient()],
});

/** German message for an error from Better Auth or the rate limiter; never reveals whether an account exists. */
export function authErrorMessage(
  error: { status?: number | undefined; code?: string | undefined } | null | undefined,
): string {
  if (!error) {
    return "";
  }
  if (error.status === 429) {
    return "Zu viele Versuche. Bitte warten Sie einige Minuten und versuchen Sie es dann erneut.";
  }
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "E-Mail-Adresse oder Passwort ist falsch.";
    case "INVALID_CODE":
    case "INVALID_TWO_FACTOR_CODE":
    case "INVALID_BACKUP_CODE":
      return "Der Code ist ungültig. Prüfen Sie die Uhrzeit Ihres Geräts und versuchen Sie es erneut.";
    case "ACCOUNT_TEMPORARILY_LOCKED":
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return "Zu viele falsche Codes. Das Konto ist vorübergehend gesperrt; versuchen Sie es in 15 Minuten erneut.";
    case "INVALID_TWO_FACTOR_COOKIE":
      return "Die Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.";
    case "PASSWORD_TOO_LONG":
      return "Das Passwort darf höchstens 128 Zeichen lang sein.";
    case "PASSWORD_TOO_SHORT":
      return "Das Passwort muss mindestens 12 Zeichen lang sein.";
    case "PASSWORD_COMPROMISED":
      return "Dieses Passwort ist aus Datenlecks bekannt. Bitte wählen Sie ein anderes.";
    case "INVALID_PASSWORD":
      return "Das Passwort ist falsch.";
    case "INVALID_TOKEN":
      return "Der Link ist ungültig oder abgelaufen. Fordern Sie bitte einen neuen an.";
    default:
      return "Das hat nicht geklappt. Bitte versuchen Sie es erneut.";
  }
}
