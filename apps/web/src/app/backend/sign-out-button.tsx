"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.replace("/anmelden");
        router.refresh();
      }}
      className="rounded-md border border-neutral-400 px-3 py-1.5 text-sm hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
    >
      Abmelden
    </button>
  );
}
