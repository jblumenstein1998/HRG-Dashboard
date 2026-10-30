"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** The block size app_activity is keyed on (see recordActivity). */
const BLOCK_MS = 5 * 60 * 1000;

/** Signs of a person at the keyboard. Mouse movement alone isn't one. */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "scroll", "touchstart"] as const;

/** Pages that aren't the dashboard proper. */
const UNTRACKED = ["/login", "/no-access"];

function ping() {
  // keepalive so a heartbeat fired as the page closes still lands. Failures
  // are ignored: a missed block is a rounding error, not worth surfacing.
  fetch("/api/activity", { method: "POST", keepalive: true }).catch(() => {});
}

/**
 * Feeds the Uses (30d) column on Users & Access.
 *
 * Pings on every page opened, and otherwise at most once per five-minute
 * block, only when someone clicks, scrolls or types with the dashboard in
 * front. A tab left open overnight sends nothing; someone who checks it once
 * an hour is counted each time. Records only that they were active — never
 * what they did.
 */
export default function ActivityTracker() {
  const pathname = usePathname();
  const lastBlock = useRef(-1);
  const tracked = !!pathname && !UNTRACKED.includes(pathname);

  useEffect(() => {
    if (!tracked) return;
    lastBlock.current = Math.floor(Date.now() / BLOCK_MS);
    ping();
  }, [pathname, tracked]);

  useEffect(() => {
    if (!tracked) return;
    const onActivity = () => {
      if (document.visibilityState !== "visible") return;
      const block = Math.floor(Date.now() / BLOCK_MS);
      if (block === lastBlock.current) return;
      lastBlock.current = block;
      ping();
    };
    const opts = { passive: true, capture: true };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, opts);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, opts);
    };
  }, [tracked]);

  return null;
}
