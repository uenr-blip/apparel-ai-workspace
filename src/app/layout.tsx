import type { Metadata } from "next";
import { Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import { Atmosphere } from "@/components/atmosphere";
import { ImageZoomRoot } from "@/components/image-zoom";

const sans = Noto_Sans_SC({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const display = Noto_Serif_SC({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: `${BRAND.name} · ${BRAND.product}`,
  description: `${BRAND.tagline}。${BRAND.description}`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={`${sans.variable} ${display.variable} h-full antialiased`}>
      <body className="relative min-h-full font-[family-name:var(--font-sans)]">
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <Atmosphere />
        <ImageZoomRoot />
        <div className="relative z-10" data-page>
          {children}
        </div>
      </body>
    </html>
  );
}
