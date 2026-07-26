import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
// The chat widget and its /api/chat route are removed from this branch while
// the assistant is reworked — it was hanging without returning an answer, and a
// disabled flag still shipped the function. The full implementation lives on
// the `chat-rework` branch; develop there and merge back when it's right.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HRG Dashboard",
  description: "Hudson Restaurant Group Performance Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="min-h-full bg-gray-50 antialiased">
        {children}
      </body>
    </html>
  );
}
