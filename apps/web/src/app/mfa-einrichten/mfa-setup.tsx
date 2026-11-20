"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth-form";
import { QrCode } from "@/components/qr-code";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { BackupCodes } from "./backup-codes";

interface Factor {
  totpURI: string;
  backupCodes: string[];
}

/** Step 1: confirm the password. Step 2: scan, save backup codes, enter the first code. */
export function MfaSetup() {
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const { data, error: enableError } = await authClient.twoFactor.enable({ password });
    setPending(false);
    setPassword("");
    if (enableError || !data || !("totpURI" in data) || !data.totpURI) {
      setError(authErrorMessage(enableError ?? { code: "UNKNOWN" }));
      return;
    }
    setFactor({ totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] });
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved) {
      setError("Bitte bestätigen Sie, dass Sie die Backup-Codes gesichert haben.");
      return;
    }
    setPending(true);
    setError("");
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code: code.replace(/\s+/g, ""),
    });
    setPending(false);
    if (verifyError) {
      setError(authErrorMessage(verifyError));
      return;
    }
    router.replace("/backend");
    router.refresh();
  }

  if (!factor) {
    return (
      <form onSubmit={start}>
        <FormMessage kind="error">{error}</FormMessage>
        <Field
          id="password"
          label="Passwort bestätigen"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          autoFocus
        />
        <SubmitButton pending={pending}>Weiter</SubmitButton>
      </form>
    );
  }

  const secret = new URL(factor.totpURI).searchParams.get("secret") ?? "";
  return (
    <form onSubmit={verify}>
      <FormMessage kind="error">{error}</FormMessage>
      <h2 className="text-lg font-semibold">1. Code scannen</h2>
      <p className="mt-1 mb-3 text-neutral-700">
        Scannen Sie den QR-Code mit Ihrer Authenticator-App.
      </p>
      <QrCode value={factor.totpURI} label="QR-Code für die Authenticator-App" />
      <p className="mt-3 text-sm text-neutral-700">
        Scannen nicht möglich? Geben Sie diesen Schlüssel in der App ein:
      </p>
      <p className="mt-1 font-mono text-sm break-all">{secret}</p>

      <h2 className="mt-8 text-lg font-semibold">2. Backup-Codes sichern</h2>
      <BackupCodes codes={factor.backupCodes} saved={saved} onSavedChange={setSaved} />

      <h2 className="mt-8 mb-3 text-lg font-semibold">3. Code eingeben</h2>
      <Field
        id="code"
        label="Code aus der Authenticator-App"
        autoComplete="one-time-code"
        inputMode="numeric"
        hint="Sechs Ziffern, die Ihre App jetzt für CommuCal anzeigt."
        value={code}
        onChange={setCode}
      />
      <SubmitButton pending={pending}>Einrichtung abschliessen</SubmitButton>
    </form>
  );
}
