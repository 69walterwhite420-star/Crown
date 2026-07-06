import type { Metadata } from "next";
// Шрифты через next/font (display: swap). CROWN: ОДИН шрифт на весь UI — Inter (заголовки и текст).
// Моно (JetBrains) — только для чисел/сумм/адресов (tabular-nums). Без декоративных серифов.
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { PageTransitions } from "@/components/layout/page-transitions";
import { Providers } from "./providers";

const body = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-body",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CROWN — crown your realm",
  description:
    "Crown a streamer with USDC on Solana and build your Reign in their realm. Non-transferable, earned crown by crown.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* Кроссфейд между страницами (нативный View Transitions API). */}
        <PageTransitions />
        <div className="flex min-h-screen flex-col">
          {/* animate-enter — мягкое проявление при ПЕРВОМ заходе на сайт (layout не перемонтируется →
              один раз; переходы между страницами делает View Transitions). Только opacity — безопасно
              для sticky-шапки/fixed-элементов. */}
          <div className="flex-1 animate-enter">
            <Providers>{children}</Providers>
          </div>
        </div>
      </body>
    </html>
  );
}
