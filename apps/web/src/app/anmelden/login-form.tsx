"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth-form";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const { data, error: signInError } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (signInError) {
      setError(authErrorMessage(signInError));
      return;
    }
    // With MFA set up, the session only exists after the code; without, the backend sends the user to the setup.
    const needsCode = data && "twoFactorRedirect" in data && data.twoFactorRedirect;
    router.push(needsCode ? "/anmelden/code" : "/backend");
  }

  return (
    <form onSubmit={onSubmit} noValidate={false}>
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
      <Field
        id="password"
        label="Passwort"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />
      <SubmitButton pending={pending}>Anmelden</SubmitButton>
      <p className="mt-4 text-sm">
        <Link href="/passwort-vergessen" className="text-blue-800 underline">
          Passwort vergessen?
        </Link>
      </p>
    </form>
  );
}
