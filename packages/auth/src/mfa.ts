/**
 * A session counts as MFA-verified only if the user has a verified TOTP factor and the session was created after
 * that factor was enabled. Better Auth replaces the session when TOTP is verified at setup and creates a session at
 * login only after the TOTP step, so older sessions (e.g. from before MFA setup) never pass.
 */
export function isMfaVerifiedSession(
  user: {
    twoFactorEnabled?: boolean | null | undefined;
    twoFactorEnabledAt?: Date | null | undefined;
  },
  session: { createdAt: Date },
): boolean {
  if (user.twoFactorEnabled !== true || !user.twoFactorEnabledAt) {
    return false;
  }
  return session.createdAt.getTime() >= user.twoFactorEnabledAt.getTime();
}
