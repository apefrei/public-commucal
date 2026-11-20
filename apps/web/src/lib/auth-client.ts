import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser client for Better Auth's endpoints under /api/auth (same origin). */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), organizationClient()],
});

export { authErrorMessage } from "@/lib/auth-messages";
