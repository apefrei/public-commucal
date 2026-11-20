import { listTenantMemberships } from "@commucal/auth";
import type { Metadata } from "next";
import { requireBackendPage } from "@/server/backend";
import { getServices } from "@/server/services";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Backend – CommuCal" };

const ROLE_LABELS = { admin: "Administration", contributor: "Redaktion" } as const;

export default async function BackendPage() {
  const user = await requireBackendPage();
  const { authDb } = await getServices();
  const memberships = await listTenantMemberships(authDb, user);

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

      <section aria-labelledby="tenants" className="mt-10">
        <h2 id="tenants" className="text-lg font-semibold">
          Ihre Gemeinden und Vereine
        </h2>
        {memberships.length === 0 ? (
          <p className="mt-2 text-neutral-700">
            Sie sind noch keiner Gemeinde und keinem Verein zugeordnet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-300">
            {memberships.map((membership) => (
              <li key={membership.tenantId} className="flex justify-between px-4 py-3">
                <span>{membership.name}</span>
                <span className="text-sm text-neutral-700">{ROLE_LABELS[membership.role]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-sm text-neutral-600">
          Kalender und Termine folgen in einem nächsten Schritt.
        </p>
      </section>
    </main>
  );
}
