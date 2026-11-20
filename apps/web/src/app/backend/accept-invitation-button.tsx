"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";

/** Accepts an invitation through Better Auth, which checks that it was sent to the signed-in user's email. */
export function AcceptInvitationButton({
  invitationId,
  tenantName,
}: {
  invitationId: string;
  tenantName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        aria-label={`Einladung von ${tenantName} annehmen`}
        onClick={async () => {
          setPending(true);
          setError("");
          const { error: acceptError } = await authClient.organization.acceptInvitation({
            invitationId,
          });
          setPending(false);
          if (acceptError) {
            setError(authErrorMessage(acceptError));
            return;
          }
          router.refresh();
        }}
        className="rounded-md bg-blue-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        Annehmen
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}
