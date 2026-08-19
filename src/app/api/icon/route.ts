import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { iconDomains } from "@/lib/adminLinks";

/**
 * Favicon lookup for the Admin tab's cards.
 *
 * This exists because the choice cannot be made in the browser. Both public
 * favicon services answer a domain they don't know with a *placeholder image*
 * — DuckDuckGo a grey circled arrow, Google a grey globe — and, decisively,
 * they send it with a 404 status and a body that decodes. Browsers render a
 * 404's body when it is a valid image, so `<img onError>` never fires and a
 * client-side chain cannot tell "here is the logo" from "here is my apology
 * for not having it". An earlier version tried exactly that and quietly
 * replaced half a dozen real logos with DuckDuckGo's placeholder.
 *
 * Here the bytes are in hand, so the placeholders can be recognised and
 * skipped. Candidates are tried most-specific-domain first, Google then
 * DuckDuckGo at each, and the first response that is a real image wins. When
 * nothing has one the route 404s with an empty body, which *does* fire the
 * image's error handler, and the card falls back to the label's initials — a
 * better answer than a grey circle, because it says which card it is.
 *
 * Not an open proxy: the only thing taken from the caller is a hostname,
 * validated against a strict pattern, and the only URLs ever fetched are the
 * two icon services' own endpoints built from it.
 */

export const runtime = "nodejs";

/** Hostnames only — no scheme, no path, no port, no credentials. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const googleUrl = (d: string) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
const ddgUrl = (d: string) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico`;

const sha = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/**
 * The hash of each service's "I don't have one" image, learned at runtime by
 * asking about a domain that cannot exist.
 *
 * Learned rather than hardcoded so that a service redesigning its placeholder
 * doesn't silently turn it back into an accepted answer — the failure mode
 * that would produce is a page of identical grey tiles, which looks like
 * content and so goes unnoticed. Memoised per process; if the probe itself
 * fails we fall back to the hashes observed on 2026-08-19, which is worse than
 * learning them and much better than trusting everything.
 */
const KNOWN_PLACEHOLDERS = new Set([
  // Google's grey globe, 726 bytes, observed 2026-08-19.
  "2d7c9b60d1e2b4f4726141de2e4ab738110b9287",
  // DuckDuckGo's grey circled arrow, 1478 bytes, same date.
  "980aa215c45dd3b92f40b272234a21f6d850b14a",
]);

let placeholders: Promise<Set<string>> | null = null;

function placeholderHashes(): Promise<Set<string>> {
  if (!placeholders) {
    placeholders = (async () => {
      const found = new Set<string>(KNOWN_PLACEHOLDERS);
      const nowhere = "definitely-not-a-real-domain-9182734.invalid";
      await Promise.all(
        [googleUrl(nowhere), ddgUrl(nowhere)].map(async (u) => {
          const bytes = await fetchBytes(u);
          if (bytes) found.add(sha(bytes));
        }),
      );
      return found;
    })().catch(() => new Set(KNOWN_PLACEHOLDERS));
  }
  return placeholders;
}

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    // Status is deliberately ignored: these services return their placeholder
    // with a 404 and real icons with a 200, but not consistently enough to
    // decide on. The bytes are the evidence.
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Answers to reject beyond the known placeholders: anything too small to be a
 * real icon. DuckDuckGo returns an 8-byte body for some domains, which is not
 * a placeholder so much as a shrug, and which would render as a broken image.
 */
const MIN_BYTES = 100;

type Icon = { body: Buffer; type: string };

/** Resolved icons, per process. A miss is cached too — as null. */
const cache = new Map<string, Icon | null>();

async function resolve(host: string): Promise<Icon | null> {
  const cached = cache.get(host);
  if (cached !== undefined) return cached;

  const bad = await placeholderHashes();
  let found: Icon | null = null;

  outer: for (const domain of iconDomains(host)) {
    for (const url of [googleUrl(domain), ddgUrl(domain)]) {
      const bytes = await fetchBytes(url);
      if (!bytes || bytes.length < MIN_BYTES) continue;
      if (bad.has(sha(bytes))) continue;
      found = { body: bytes, type: url.includes("duckduckgo") ? "image/x-icon" : "image/png" };
      break outer;
    }
  }

  cache.set(host, found);
  return found;
}

export async function GET(request: NextRequest) {
  const host = (request.nextUrl.searchParams.get("host") ?? "").toLowerCase();
  if (!HOST.test(host) || host.length > 253) {
    return new Response(null, { status: 400 });
  }

  const icon = await resolve(host);

  // An empty 404 is the point: it is the one response that makes the browser
  // fire the image's error handler, which is what shows the initials.
  if (!icon) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  return new Response(new Uint8Array(icon.body), {
    headers: {
      "Content-Type": icon.type,
      // These change about as often as a company rebrands.
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
    },
  });
}
