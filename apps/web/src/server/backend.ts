import "server-only";
import { type BackendUser, getBackendAccess } from "@commucal/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/server/services";

/**
 * For every backend page: returns the MFA-verified user, or redirects to the login or the MFA setup (FR-3).
 * Route handlers and server actions use requireBackendUser() from @commucal/auth instead.
 */
export async function requireBackendPage(): Promise<BackendUser> {
  // headers() first: it makes the page dynamic, so nothing here runs at build time.
  const requestHeaders = await headers();
  const { auth } = await getServices();
  const access = await getBackendAccess(auth, requestHeaders);
  if (access.kind === "signed_out") {
    redirect("/anmelden");
  }
  if (access.kind === "mfa_setup_required") {
    redirect("/mfa-einrichten");
  }
  return access.user;
}
