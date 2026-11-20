import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-form";
import { CodeForm } from "./code-form";

export const metadata: Metadata = { title: "Bestätigungscode – CommuCal" };

export default function CodePage() {
  return (
    <AuthCard title="Bestätigungscode">
      <CodeForm />
    </AuthCard>
  );
}
