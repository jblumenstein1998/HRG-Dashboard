"use client";

import { usePathname } from "next/navigation";
import ChatWidget from "./ChatWidget";

export default function ChatWidgetGate() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return <ChatWidget />;
}
