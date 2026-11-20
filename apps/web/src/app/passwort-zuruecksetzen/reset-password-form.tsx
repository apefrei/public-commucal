"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth-form";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setPending(true);
    setError("");
    const { error: resetError } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (resetError) {
      setError(authErrorMessage(resetError));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <>
        <FormMessage kind="info">
          Ihr Passwort wurde geändert, alle Sitzungen wurden beendet. Ihre
          Zwei-Faktor-Authentifizierung bleibt unverändert.
        </FormMessage>
        <Link href="/anmelden" className="text-sm text-blue-800 underline">
          Zur Anmeldung
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <FormMessage kind="error">{error}</FormMessage>
      <Field
        id="new-password"
        label="Neues Passwort"
        type="password"
        autoComplete="new-password"
        hint="Mindestens 12 Zeichen. Ein Satz aus mehreren Wörtern ist sicher und gut zu merken."
        value={password}
        onChange={setPassword}
        autoFocus
      />
      <Field
        id="confirm-password"
        label="Neues Passwort wiederholen"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={setConfirmation}
      />
      <SubmitButton pending={pending}>Passwort speichern</SubmitButton>
    </form>
  );
}
