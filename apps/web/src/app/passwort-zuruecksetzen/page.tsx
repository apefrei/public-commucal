import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, FormMessage } from "@/components/auth-form";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Neues Passwort – CommuCal" };

/** Better Auth checks the emailed link and redirects here with ?token=… or ?error=INVALID_TOKEN (FR-7). */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = await searchParams;
  if (typeof token !== "string" || error) {
    return (
      <AuthCard title="Neues Passwort">
        <FormMessage kind="error">
          Der Link ist ungültig oder abgelaufen. Fordern Sie bitte einen neuen an.
        </FormMessage>
        <Link href="/passwort-vergessen" className="text-sm text-blue-800 underline">
          Neuen Link anfordern
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Neues Passwort">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
