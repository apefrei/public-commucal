import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-form";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden – CommuCal" };

export default function LoginPage() {
  return (
    <AuthCard title="Anmelden">
      <LoginForm />
    </AuthCard>
  );
}
