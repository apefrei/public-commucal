import { getBackendAccess } from "@commucal/auth";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-form";
import { getServices } from "@/server/services";
import { MfaSetup } from "./mfa-setup";

export const metadata: Metadata = { title: "Zwei-Faktor-Authentifizierung einrichten – CommuCal" };

/** The only backend page a session without MFA may open (FR-3). */
export default async function MfaSetupPage() {
  const requestHeaders = await headers();
  const { auth } = await getServices();
  const access = await getBackendAccess(auth, requestHeaders);
  if (access.kind === "signed_out") {
    redirect("/anmelden");
  }
  if (access.kind === "granted") {
    redirect("/backend");
  }
  return (
    <AuthCard title="Zwei-Faktor-Authentifizierung einrichten">
      <p className="mb-6 text-neutral-700">
        Für alle CommuCal-Konten ist ein zweiter Faktor vorgeschrieben. Sie brauchen eine
        Authenticator-App, zum Beispiel Microsoft Authenticator, Google Authenticator, Aegis oder
        die Passwörter-App auf dem iPhone.
      </p>
      <MfaSetup />
    </AuthCard>
  );
}
