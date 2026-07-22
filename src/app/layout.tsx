import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import ChatWidgetGate from "@/components/ChatWidgetGate";

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
        <ChatWidgetGate />
      </body>
    </html>
  );
}
