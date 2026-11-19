import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "CommuCal",
  description: "Kalender von Gemeinden und Vereinen abonnieren",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
