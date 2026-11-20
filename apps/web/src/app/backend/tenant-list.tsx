import type { TenantMembership } from "@commucal/auth";
import { InviteForm } from "./invite-form";

const ROLE_LABELS = { admin: "Administration", contributor: "Redaktion" } as const;

/** Tenants of the user; admins can invite people to each of their tenants. */
export function TenantList({ memberships }: { memberships: TenantMembership[] }) {
  if (memberships.length === 0) {
    return (
      <p className="mt-2 text-neutral-700">
        Sie sind noch keiner Gemeinde und keinem Verein zugeordnet.
      </p>
    );
  }
  return (
    <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-300">
      {memberships.map((membership) => (
        <li key={membership.tenantId} className="px-4 py-3">
          <div className="flex justify-between gap-4">
            <span className="font-medium">{membership.name}</span>
            <span className="text-sm text-neutral-700">{ROLE_LABELS[membership.role]}</span>
          </div>
          {membership.role === "admin" ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-blue-800 underline">
                Person einladen
              </summary>
              <InviteForm tenantId={membership.tenantId} tenantName={membership.name} />
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
