"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { activityTab } from "@/lib/users/activityTab";

/** Keep in step with ACTIVITY_BLOCK_MINUTES in lib/users/store. */
const BLOCK_MS = 5 * 60 * 1000;

/** Signs of a person at the keyboard. Mouse movement alone isn't one. */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "scroll", "touchstart"] as const;

function send(path: string, kind: "view" | "active") {
  // keepalive so a heartbeat fired as the page closes still lands. Failures
  // are ignored: a missed block is a rounding error, not worth surfacing.
  fetch("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, kind }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Measures engagement for the Usage panel on Users & Access.
 *
 * Reports a page open on every navigation, and otherwise at most one
 * heartbeat per five-minute block, only when someone clicks, scrolls or types
 * with the tab in front. A tab left open overnight sends nothing; someone who
 * checks it once an hour earns a block each time. Records that they were
 * active and on which tab — never what they did.
 *
 * Renders nothing, and does nothing off the tabs (login, no-access).
 */
export default function ActivityTracker() {
  const pathname = usePathname();
  const lastBlock = useRef(-1);

  useEffect(() => {
    if (!activityTab(pathname)) return;
    lastBlock.current = Math.floor(Date.now() / BLOCK_MS);
    send(pathname, "view");
  }, [pathname]);

  useEffect(() => {
    if (!activityTab(pathname)) return;
    const onActivity = () => {
      if (document.visibilityState !== "visible") return;
      const block = Math.floor(Date.now() / BLOCK_MS);
      if (block === lastBlock.current) return;
      lastBlock.current = block;
      send(pathname, "active");
    };
    const opts = { passive: true, capture: true };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, opts);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, opts);
    };
  }, [pathname]);

  return null;
}
