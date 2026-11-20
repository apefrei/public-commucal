import { getOpenInvitation } from "@commucal/auth";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AuthCard, FormMessage } from "@/components/auth-form";
import { getServices } from "@/server/services";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Einladung – CommuCal", robots: { index: false } };

const ROLE_LABELS = { admin: "Administrator/in", contributor: "Redaktor/in" } as const;

/** Target of the invitation email (FR-2). The id in the URL is the secret; nothing is shown for invalid links. */
export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  await headers();
  const { id } = await params;
  const { authDb } = await getServices();
  const invitation = await getOpenInvitation(authDb, id);

  if (!invitation) {
    return (
      <AuthCard title="Einladung">
        <FormMessage kind="error">
          Diese Einladung ist ungültig, abgelaufen oder wurde bereits angenommen. Bitten Sie die
          Person, die Sie eingeladen hat, um eine neue Einladung.
        </FormMessage>
      </AuthCard>
    );
  }

  const intro = (
    <p className="mb-6 text-neutral-700">
      Sie wurden eingeladen, bei «{invitation.tenantName}» als {ROLE_LABELS[invitation.role]}{" "}
      mitzuarbeiten.
    </p>
  );

  if (invitation.accountExists) {
    return (
      <AuthCard title="Einladung">
        {intro}
        <p className="mb-4 text-neutral-700">
          Für {invitation.email} besteht bereits ein Konto. Melden Sie sich an; die Einladung können
          Sie danach im Backend annehmen.
        </p>
        <Link href="/anmelden" className="text-blue-800 underline">
          Zur Anmeldung
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Konto erstellen">
      {intro}
      <RegisterForm invitationId={invitation.id} email={invitation.email} />
    </AuthCard>
  );
}
