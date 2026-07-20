"use client";

import { useState, type RefObject } from "react";
import { toCanvas } from "html-to-image";

type Status = "idle" | "copying" | "done" | "error";

// Every copied chart/table pastes at this same logical width regardless of its actual
// on-screen size, so a narrow table and a wide chart look consistent side by side —
// height scales proportionally to preserve aspect ratio.
const TARGET_WIDTH_PX = 1200;
const OUTPUT_PIXEL_RATIO = 2; // final output resolution multiplier, for crispness on paste
const CAPTURE_BG = "#ffffff";

// Crops the canvas down to the bounding box of its actual (non-background) content
// on all four sides. The safety buffer in `copy()` intentionally over-captures
// height to dodge a rendering crop bug, and any pre-existing margin (e.g. a card's
// own margin-top) can also sneak into the raw capture — this removes all of it so
// the output is just the tight outline of the cards, no border.
function trimToContent(canvas: HTMLCanvasElement, bgColor: string): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return canvas;

  const bgMatch = bgColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const bg = bgMatch ? [parseInt(bgMatch[1], 16), parseInt(bgMatch[2], 16), parseInt(bgMatch[3], 16)] : [255, 255, 255];
  const TOLERANCE = 4;

  const { data } = ctx.getImageData(0, 0, width, height);
  const isContent = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return (
      data[i + 3] > 0 &&
      (Math.abs(data[i] - bg[0]) > TOLERANCE ||
        Math.abs(data[i + 1] - bg[1]) > TOLERANCE ||
        Math.abs(data[i + 2] - bg[2]) > TOLERANCE)
    );
  };

  let top = 0, bottom = height - 1, left = 0, right = width - 1;

  topScan: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 4) if (isContent(x, y)) { top = y; break topScan; }
  }
  bottomScan: for (let y = height - 1; y >= top; y--) {
    for (let x = 0; x < width; x += 4) if (isContent(x, y)) { bottom = y; break bottomScan; }
  }
  leftScan: for (let x = 0; x < width; x++) {
    for (let y = top; y <= bottom; y += 4) if (isContent(x, y)) { left = x; break leftScan; }
  }
  rightScan: for (let x = width - 1; x >= left; x--) {
    for (let y = top; y <= bottom; y += 4) if (isContent(x, y)) { right = x; break rightScan; }
  }

  if (top === 0 && bottom === height - 1 && left === 0 && right === width - 1) return canvas; // nothing to trim

  const trimmed = document.createElement("canvas");
  trimmed.width = right - left + 1;
  trimmed.height = bottom - top + 1;
  trimmed.getContext("2d")?.drawImage(canvas, -left, -top);
  return trimmed;
}

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

      // html-to-image's internal SVG-foreignObject clone occasionally renders a hair
      // taller than the live node (sub-pixel/border differences), which silently
      // crops the last row of content when the canvas is sized to the exact live
      // measurement. Over-capturing height and trimming the resulting blank rows
      // back off (below) avoids that without leaving a visible margin.
      const nodeRect = node.getBoundingClientRect();
      const rawCanvas = await toCanvas(node, {
        pixelRatio: 2,
        height: Math.ceil(nodeRect.height) + 40,
        backgroundColor: CAPTURE_BG,
        filter: (el) => !(el instanceof HTMLElement && el.hasAttribute("data-copy-image-ignore")),
      });
      const sourceCanvas = trimToContent(rawCanvas, CAPTURE_BG);

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
