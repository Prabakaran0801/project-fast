import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Speed Downloader — Paste. Detect. Download fast.",
  description: "High-performance video downloader + WeTransfer-style file sharing. Auto-detect videos from any URL, direct CDN delivery, resumable uploads.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-[#09090b] text-zinc-100">
        <script dangerouslySetInnerHTML={{ __html: `try{document.querySelectorAll('[bis_skin_checked]').forEach(e=>e.removeAttribute('bis_skin_checked'))}catch{}` }} />
        {children}</body>
    </html>
  );
}
