import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import s from "./Markdown.module.css";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "IMG") node.setAttribute("loading", "lazy");
});

/** Untrusted Markdown (content source bodies, changelogs): sanitized, links open in the system browser. */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false })), [source]);
  return (
    <div
      className={s.md}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as Element).closest("a");
        if (!a) return;
        // Navigating would replace the launcher itself inside the webview.
        e.preventDefault();
        const href = a.getAttribute("href") ?? "";
        if (/^https?:\/\//.test(href)) openUrl(href);
      }}
    />
  );
}
