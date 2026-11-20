import type { EmailJob } from "@commucal/db";

export interface RenderedEmail {
  subject: string;
  text: string;
}

const ROLE_LABELS = { admin: "Administrator/in", contributor: "Redaktor/in" } as const;

const FOOTER = [
  "",
  "--",
  "CommuCal – Kalender von Gemeinden und Vereinen",
  "Diese E-Mail wurde automatisch versendet. Antworten werden nicht gelesen.",
].join("\n");

/**
 * Plain-text emails in German (backend users; ADR-0006). Plain text keeps them simple and leaves no room for HTML
 * injection through tenant names.
 */
export function renderEmail(job: EmailJob): RenderedEmail {
  switch (job.template) {
    case "password_reset":
      return {
        subject: "Passwort zurücksetzen",
        text: [
          "Guten Tag",
          "",
          "Sie haben verlangt, Ihr CommuCal-Passwort zurückzusetzen. Öffnen Sie dazu diesen Link:",
          "",
          job.url,
          "",
          "Der Link ist eine Stunde gültig und kann nur einmal verwendet werden. Ihre Zwei-Faktor-",
          "Authentifizierung bleibt unverändert.",
          "",
          "Haben Sie das nicht verlangt? Dann können Sie diese E-Mail ignorieren; Ihr Passwort bleibt gleich.",
          FOOTER,
        ].join("\n"),
      };
    case "invitation":
      return {
        subject: `Einladung zu CommuCal: ${job.tenantName}`,
        text: [
          "Guten Tag",
          "",
          `Sie wurden eingeladen, bei «${job.tenantName}» auf CommuCal als ${ROLE_LABELS[job.role]} mitzuarbeiten.`,
          "Öffnen Sie diesen Link, um die Einladung anzunehmen:",
          "",
          job.url,
          "",
          "Die Einladung ist sieben Tage gültig. Bei der ersten Anmeldung richten Sie eine Zwei-Faktor-",
          "Authentifizierung mit einer Authenticator-App ein; sie ist für alle Konten vorgeschrieben.",
          FOOTER,
        ].join("\n"),
      };
    case "mfa_reset":
      return {
        subject: "Ihre Zwei-Faktor-Authentifizierung wurde zurückgesetzt",
        text: [
          "Guten Tag",
          "",
          "Eine Administratorin oder ein Administrator hat die Zwei-Faktor-Authentifizierung Ihres CommuCal-Kontos",
          "zurückgesetzt. Alle Ihre Sitzungen wurden beendet. Bei der nächsten Anmeldung richten Sie die",
          "Zwei-Faktor-Authentifizierung neu ein:",
          "",
          job.url,
          "",
          "Haben Sie das nicht veranlasst? Wenden Sie sich bitte umgehend an die Administration Ihrer Gemeinde",
          "oder Ihres Vereins.",
          FOOTER,
        ].join("\n"),
      };
  }
}
