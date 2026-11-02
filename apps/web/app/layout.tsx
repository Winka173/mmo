import "./globals.css";
import "./studio.css";
import StudioShell from "./components/StudioShell";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

export const metadata = { title: "AUTONOMOUS CREATIVE STUDIO" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = (await cookies()).get("acs_locale")?.value === "en" ? "en" : "vi";
  return (
    <html lang={locale}>
      <body>
        <StudioShell initialLocale={locale}>{children}</StudioShell>
      </body>
    </html>
  );
}
