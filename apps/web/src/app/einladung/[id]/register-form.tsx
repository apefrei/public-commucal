"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth-form";
import { registerInvited } from "./actions";

export function RegisterForm({ invitationId, email }: { invitationId: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await registerInvited({ invitationId, name, password, confirmation });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push("/anmelden?registriert=1");
  }

  return (
    <form onSubmit={onSubmit}>
      <FormMessage kind="error">{error}</FormMessage>
      <p className="mb-4 text-sm text-neutral-700">
        E-Mail-Adresse: <span className="font-medium">{email}</span>
      </p>
      <Field
        id="name"
        label="Ihr Name"
        autoComplete="name"
        value={name}
        onChange={setName}
        autoFocus
      />
      <Field
        id="new-password"
        label="Passwort"
        type="password"
        autoComplete="new-password"
        hint="Mindestens 12 Zeichen. Ein Satz aus mehreren Wörtern ist sicher und gut zu merken."
        value={password}
        onChange={setPassword}
      />
      <Field
        id="confirm-password"
        label="Passwort wiederholen"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={setConfirmation}
      />
      <SubmitButton pending={pending}>Konto erstellen</SubmitButton>
    </form>
  );
}
