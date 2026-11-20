import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-form";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Passwort vergessen – CommuCal" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Passwort vergessen">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
