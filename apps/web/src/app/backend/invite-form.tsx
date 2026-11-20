"use client";

import { type FormEvent, useId, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth-form";
import { invitePerson } from "./actions";

/** Invite a person to one tenant (FR-2). */
export function InviteForm({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "contributor">("contributor");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const result = await invitePerson({ tenantId, email, role });
    setPending(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    setMessage({ kind: "info", text: `Die Einladung an ${email} wurde versendet.` });
    setEmail("");
  }

  return (
    <form onSubmit={onSubmit} aria-label={`Person zu ${tenantName} einladen`} className="mt-3">
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <Field
        id={`${id}-email`}
        label="E-Mail-Adresse"
        type="email"
        autoComplete="off"
        value={email}
        onChange={setEmail}
      />
      <div className="mb-4">
        <label htmlFor={`${id}-role`} className="block text-sm font-medium">
          Rolle
        </label>
        <select
          id={`${id}-role`}
          value={role}
          onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "contributor")}
          className="mt-1 block w-full rounded-md border border-neutral-400 px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        >
          <option value="contributor">Redaktion</option>
          <option value="admin">Administration</option>
        </select>
      </div>
      <SubmitButton pending={pending}>Einladen</SubmitButton>
    </form>
  );
}
