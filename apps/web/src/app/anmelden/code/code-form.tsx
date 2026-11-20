"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth-form";
import { authClient, authErrorMessage } from "@/lib/auth-client";

/** Second login step: TOTP code from the authenticator app, or one of the backup codes. */
export function CodeForm() {
  const router = useRouter();
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const trimmed = code.replace(/\s+/g, "");
    const { error: verifyError } = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code: trimmed })
      : await authClient.twoFactor.verifyTotp({ code: trimmed });
    setPending(false);
    if (verifyError) {
      setError(authErrorMessage(verifyError));
      return;
    }
    router.push("/backend");
  }

  return (
    <form onSubmit={onSubmit}>
      <FormMessage kind="error">{error}</FormMessage>
      <Field
        id="code"
        label={useBackupCode ? "Backup-Code" : "Code aus der Authenticator-App"}
        autoComplete="one-time-code"
        inputMode={useBackupCode ? "text" : "numeric"}
        hint={
          useBackupCode
            ? "Jeder Backup-Code funktioniert nur einmal."
            : "Sechs Ziffern, die Ihre App für CommuCal anzeigt."
        }
        value={code}
        onChange={setCode}
        autoFocus
      />
      <SubmitButton pending={pending}>Bestätigen</SubmitButton>
      <button
        type="button"
        onClick={() => {
          setUseBackupCode(!useBackupCode);
          setCode("");
          setError("");
        }}
        className="mt-4 text-sm text-blue-800 underline"
      >
        {useBackupCode ? "Code aus der App verwenden" : "Backup-Code verwenden"}
      </button>
    </form>
  );
}
