import type { Metadata } from "next";
import { AuthCard, FormMessage } from "@/components/auth-form";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden – CommuCal" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { registriert } = await searchParams;
  return (
    <AuthCard title="Anmelden">
      {registriert === "1" ? (
        <FormMessage kind="info">
          Ihr Konto ist erstellt. Melden Sie sich jetzt an; danach richten Sie die
          Zwei-Faktor-Authentifizierung ein und nehmen die Einladung an.
        </FormMessage>
      ) : null}
      <LoginForm />
    </AuthCard>
  );
}
