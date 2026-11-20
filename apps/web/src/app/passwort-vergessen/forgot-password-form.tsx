"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth-form";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const { error: requestError } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/passwort-zuruecksetzen",
    });
    setPending(false);
    if (requestError) {
      setError(authErrorMessage(requestError));
      return;
    }
    setSent(true);
  }

  if (sent) {
    // Same answer whether or not an account exists.
    return (
      <>
        <FormMessage kind="info">
          Falls ein Konto mit dieser Adresse besteht, haben wir einen Link zum Zurücksetzen
          gesendet. Er ist eine Stunde gültig.
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
        id="email"
        label="E-Mail-Adresse"
        type="email"
        autoComplete="username"
        value={email}
        onChange={setEmail}
        autoFocus
      />
      <SubmitButton pending={pending}>Link senden</SubmitButton>
    </form>
  );
}
