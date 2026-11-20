import { listPendingInvitations, listTenantMemberships } from "@commucal/auth";
import type { Metadata } from "next";
import { requireBackendPage } from "@/server/backend";
import { getServices } from "@/server/services";
import { AcceptInvitationButton } from "./accept-invitation-button";
import { SignOutButton } from "./sign-out-button";
import { TenantList } from "./tenant-list";

export const metadata: Metadata = { title: "Backend – CommuCal" };

const ROLE_LABELS = { admin: "Administration", contributor: "Redaktion" } as const;

export default async function BackendPage() {
  const user = await requireBackendPage();
  const { authDb } = await getServices();
  const [memberships, invitations] = await Promise.all([
    listTenantMemberships(authDb, user),
    listPendingInvitations(authDb, user),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-wide text-neutral-600">CommuCal</p>
          <h1 className="mt-1 text-2xl font-semibold">Guten Tag, {user.name}</h1>
          {user.globalAdmin ? (
            <p className="mt-1 text-sm text-neutral-700">Sie sind Global-Admin.</p>
          ) : null}
        </div>
        <SignOutButton />
      </header>

      {invitations.length > 0 ? (
        <section aria-labelledby="invitations" className="mt-10">
          <h2 id="invitations" className="text-lg font-semibold">
            Offene Einladungen
          </h2>
          <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-300">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span>
                  {invitation.tenantName}{" "}
                  <span className="text-sm text-neutral-700">({ROLE_LABELS[invitation.role]})</span>
                </span>
                <AcceptInvitationButton
                  invitationId={invitation.id}
                  tenantName={invitation.tenantName}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="tenants" className="mt-10">
        <h2 id="tenants" className="text-lg font-semibold">
          Ihre Gemeinden und Vereine
        </h2>
        <TenantList memberships={memberships} />
        <p className="mt-6 text-sm text-neutral-600">
          Kalender und Termine folgen in einem nächsten Schritt.
        </p>
      </section>
    </main>
  );
}
