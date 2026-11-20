import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Doc Summarizer",
  description:
    "Summarize any web page, pasted text, or YouTube transcript at three depth levels, then ask follow-up questions grounded in the original content via hybrid RAG.",
  keywords: [
    "summarizer",
    "doc",
    "RAG",
    "youtube",
    "transcript",
    "Next.js",
    "z-ai-web-dev-sdk",
    "BM25",
  ],
  authors: [{ name: "Doc Summarizer" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
