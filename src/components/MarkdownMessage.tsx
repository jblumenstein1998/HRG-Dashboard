"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => <code className="bg-black/5 rounded px-1 py-0.5 text-xs">{children}</code>,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-1.5 rounded-lg border border-gray-200 bg-white">
      <table className="text-xs border-collapse w-full">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
  tbody: ({ children }) => <tbody className="[&>tr:nth-child(even)]:bg-gray-50/60">{children}</tbody>,
  th: ({ children }) => (
    <th className="px-2.5 py-1.5 text-left font-semibold text-gray-600 whitespace-nowrap border-b border-gray-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums border-b border-gray-100">{children}</td>
  ),
};

export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
