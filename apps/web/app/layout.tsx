import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Tủ Tò Mò — Control Center" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
            <span className="font-bold text-amber-600">Tủ Tò Mò</span>
            <Link href="/">Bảng điều khiển</Link>
            <Link href="/jobs">Hàng đợi & duyệt</Link>
            <Link href="/settings">Cài đặt</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
