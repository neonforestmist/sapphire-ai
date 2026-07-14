import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@excalidraw/excalidraw/index.css";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "SapphireAI - The interviewer that can see how you think",
    template: "%s | SapphireAI"
  },
  description:
    "Choose a technical interview, speak or type your reasoning, and build the answer on a whiteboard that grounds every follow-up.",
  applicationName: "SapphireAI",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
