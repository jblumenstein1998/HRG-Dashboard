// The agent writes standard Markdown (it's shared with the web chat UI, which
// renders that fine), but Slack's "mrkdwn" format has no table syntax, and
// bold markup is inert inside a monospace code block — so neither a raw
// markdown table nor a code-block table can show bold summary rows. Slack's
// Block Kit is the only way to get both real bold text and a real divider
// line, so table rows are rendered as naturally-wrapping "*Label* — metric:
// value" lines (grouped into one block per contiguous run) instead of
// fixed-width columns — that's also what makes it reflow cleanly on a narrow
// phone screen instead of needing horizontal scroll.
//
// The agent isn't consistent about *how* it renders a table in Markdown —
// sometimes real `| pipe | delimited |` syntax, sometimes a plain
// space-padded ASCII table with no pipes at all — so both shapes are detected
// here rather than relying on the model to always pick one.

import type { MetricDisplay } from "@/lib/tools/displayFormat";

export type SlackBlock = { type: "section"; text: { type: "mrkdwn"; text: string } } | { type: "divider" };

// ── Figures rendered from tool output, not from prose ────────────────────────
// Numbers reach Slack through these blocks, built directly from what the tool
// returned. The model chooses which tool runs and writes the commentary around
// the card, but it never supplies the digits — so a figure here cannot be
// invented, and the house formatting cannot be violated.

/** Renders one tool's display block as Slack section blocks. */
export function displayToSlackBlocks(display: MetricDisplay): SlackBlock[] {
  const header = display.subtitle
    ? `*${display.title}*\n_${display.subtitle}_`
    : `*${display.title}*`;
  const rows = display.rows.map(r => `${r.label}: *${r.value}*`).join("\n");

  const blocks: SlackBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: `${header}\n${rows}` } },
  ];
  if (display.note) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `:warning: _${display.note}_` } });
  }
  return blocks;
}

/** Plain-text mirror of a card, for the notification preview and accessibility. */
export function displayToFallbackText(display: MetricDisplay): string {
  const rows = display.rows.map(r => `${r.label}: ${r.value}`).join(" | ");
  return [display.title, display.subtitle, rows, display.note].filter(Boolean).join(" — ");
}

type ParsedTable = { headers: string[]; rows: string[][] };

const PIPE_TABLE_REGEX = /^\|.*\|\r?\n\|[-:| ]+\|\r?\n(?:\|.*\|\r?\n?)+/gm;

// A run of 3+ consecutive lines that each split into the same number (3+) of
// fields on 2-or-more spaces — the shape of a plain-text aligned table.
const ASCII_TABLE_LINE = /^\S.*?(?: {2,}\S.*?){2,}$/;

function boldToSlack(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

function isSummaryLabel(label: string): boolean {
  return /total|summary/i.test(label);
}

function parsePipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function parsePipeTable(block: string): ParsedTable {
  const lines = block.trim().split("\n");
  return { headers: parsePipeRow(lines[0]), rows: lines.slice(2).map(parsePipeRow) };
}

function parseAsciiTable(block: string): ParsedTable {
  const lines = block.trim().split("\n");
  const split = (line: string) => line.trim().split(/ {2,}/);
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

function tableToBlocks(table: ParsedTable): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  let group: string[] = [];
  const flushGroup = () => {
    if (group.length > 0) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: group.join("\n") } });
      group = [];
    }
  };

  for (const row of table.rows) {
    const cells = row.map((cell) => cell.replace(/\*\*/g, "").trim());
    const label = cells[0] ?? "";
    const isSummaryRow = row.some((cell) => /^\*\*.*\*\*$/.test(cell)) || isSummaryLabel(label);
    const metrics = table.headers
      .slice(1)
      .map((header, i) => `${header}: ${cells[i + 1] ?? ""}`)
      .join("  •  ");

    if (isSummaryRow) {
      flushGroup();
      blocks.push({ type: "divider" });
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${label} — ${metrics}*` } });
    } else {
      group.push(`*${label}* — ${metrics}`);
    }
  }
  flushGroup();

  return blocks;
}

// Finds every contiguous run of 3+ ASCII-table-shaped lines with a consistent
// column count, outside of any text already claimed by a pipe-table match.
function findAsciiTables(text: string): { start: number; end: number; table: ParsedTable }[] {
  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const matches: { start: number; end: number; table: ParsedTable }[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!ASCII_TABLE_LINE.test(lines[i])) {
      i++;
      continue;
    }
    const colCount = lines[i].trim().split(/ {2,}/).length;
    let j = i + 1;
    while (j < lines.length && ASCII_TABLE_LINE.test(lines[j]) && lines[j].trim().split(/ {2,}/).length === colCount) {
      j++;
    }
    if (j - i >= 3) {
      const blockText = lines.slice(i, j).join("\n");
      const end = lineStarts[j - 1] + lines[j - 1].length;
      matches.push({ start: lineStarts[i], end, table: parseAsciiTable(blockText) });
    }
    i = j > i ? j : i + 1;
  }
  return matches;
}

export function markdownToSlackBlocks(markdown: string): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  let lastIndex = 0;
  PIPE_TABLE_REGEX.lastIndex = 0;

  const emitText = (segment: string) => {
    // Within a non-table segment, an ASCII-table-shaped run may still be present.
    const asciiMatches = findAsciiTables(segment);
    let cursor = 0;
    for (const m of asciiMatches) {
      const before = segment.slice(cursor, m.start).trim();
      if (before) blocks.push({ type: "section", text: { type: "mrkdwn", text: boldToSlack(before) } });
      blocks.push(...tableToBlocks(m.table));
      cursor = m.end;
    }
    const rest = segment.slice(cursor).trim();
    if (rest) blocks.push({ type: "section", text: { type: "mrkdwn", text: boldToSlack(rest) } });
  };

  let match: RegExpExecArray | null;
  while ((match = PIPE_TABLE_REGEX.exec(markdown)) !== null) {
    emitText(markdown.slice(lastIndex, match.index));
    blocks.push(...tableToBlocks(parsePipeTable(match[0])));
    lastIndex = match.index + match[0].length;
  }
  emitText(markdown.slice(lastIndex));

  return blocks;
}

// Slack requires a plain-text `text` fallback alongside `blocks` (shown in
// notifications, previews, and screen readers) — collapse tables down to a
// placeholder rather than trying to preserve their shape in plain text.
export function fallbackText(markdown: string): string {
  let collapsed = markdown.replace(PIPE_TABLE_REGEX, "[table — see message]\n");
  // Replace matches back-to-front so each splice doesn't shift the offsets of matches still pending.
  const asciiMatches = findAsciiTables(collapsed);
  for (let i = asciiMatches.length - 1; i >= 0; i--) {
    const m = asciiMatches[i];
    collapsed = collapsed.slice(0, m.start) + "[table — see message]" + collapsed.slice(m.end);
  }
  collapsed = boldToSlack(collapsed).trim();
  return collapsed.length > 0 ? collapsed.slice(0, 2900) : "Here's your answer.";
}
