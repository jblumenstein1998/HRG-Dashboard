"use client";

import { useState, type RefObject } from "react";
import { toCanvas } from "html-to-image";

type Status = "idle" | "copying" | "done" | "error";

// Every copied chart/table pastes at this same logical width regardless of its actual
// on-screen size, so a narrow table and a wide chart look consistent side by side —
// height scales proportionally to preserve aspect ratio.
const TARGET_WIDTH_PX = 1200;
const OUTPUT_PIXEL_RATIO = 2; // final output resolution multiplier, for crispness on paste

export function useCopyImage(targetRef: RefObject<HTMLElement | null>) {
  const [status, setStatus] = useState<Status>("idle");

  const copy = async () => {
    const node = targetRef.current;
    if (!node) return;
    setStatus("copying");
    try {
      // html-to-image clones the DOM by serializing attributes, but React only ever
      // updates a controlled checkbox's live `.checked` property, never the underlying
      // HTML attribute — so a box unchecked after first mount still has the "checked"
      // attribute from initial render. Sync attributes to the live property first so
      // the capture reflects what's actually selected on screen.
      node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
        if (cb.checked) cb.setAttribute("checked", "");
        else cb.removeAttribute("checked");
      });

      const sourceCanvas = await toCanvas(node, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        filter: (el) => !(el instanceof HTMLElement && el.hasAttribute("data-copy-image-ignore")),
      });

      // Rescale the already-rendered capture to a fixed output width, preserving aspect ratio.
      const targetWidthPx  = TARGET_WIDTH_PX * OUTPUT_PIXEL_RATIO;
      const scale           = targetWidthPx / sourceCanvas.width;
      const targetHeightPx = Math.round(sourceCanvas.height * scale);

      const outCanvas = document.createElement("canvas");
      outCanvas.width  = targetWidthPx;
      outCanvas.height = targetHeightPx;
      const ctx = outCanvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");
      ctx.drawImage(sourceCanvas, 0, 0, targetWidthPx, targetHeightPx);

      const blob = await new Promise<Blob | null>(resolve => outCanvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("No image data produced");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("done");
    } catch (err) {
      console.error("[useCopyImage] copy failed", err);
      setStatus("error");
    } finally {
      setTimeout(() => setStatus("idle"), 1500);
    }
  };

  return { status, copy };
}

export function CopyableTitle({
  title,
  targetRef,
  className = "text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700",
}: {
  title: string;
  targetRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const { status, copy } = useCopyImage(targetRef);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={copy}
        disabled={status === "copying"}
        title="Click to copy chart as an image"
        className={`transition text-left cursor-pointer disabled:cursor-wait ${className}`}
      >
        {title}
      </button>
      {status !== "idle" && (
        <span
          data-copy-image-ignore="true"
          className={`text-xs font-medium normal-case tracking-normal ${
            status === "done"  ? "text-green-600" :
            status === "error" ? "text-red-600"   :
            "text-gray-400"
          }`}
        >
          {status === "copying" ? "Copying…" : status === "done" ? "Copied!" : "Copy failed"}
        </span>
      )}
    </span>
  );
}
