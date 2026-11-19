import { TENANT_TIME_ZONE } from "@commucal/core";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold">CommuCal</h1>
      <p className="mt-4 text-neutral-700">
        Kalender von Gemeinden und Vereinen abonnieren – bald verfügbar.
      </p>
      <p className="mt-2 text-sm text-neutral-600">Zeitzone: {TENANT_TIME_ZONE}</p>
    </main>
  );
}
