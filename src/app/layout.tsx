import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Spectrum CRM", template: "%s · Spectrum CRM" },
  description: "Spectrum Group CRM & Agile Platform — customers, revenue and engineering delivery in one workspace.",
  applicationName: "Spectrum CRM",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#202020",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${montserrat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
