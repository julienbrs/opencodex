import { openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { OcxConfig } from "../../types";
import type { RawEntry } from "./parsing";

const PREFIX = "chatgpt-web/";
const OWNER = "opencodex_chatgpt_web";

/** The Web backend exports only its own rows. It never writes Codex's shared catalogue. */
export function mergeChatgptWebCatalog(entries: RawEntry[], config: Readonly<OcxConfig>): RawEntry[] {
  if (!config.chatgptWeb) return entries.filter(entry => entry[OWNER] !== true);
  const native = entries.filter(entry => entry[OWNER] !== true && !String(entry.slug ?? "").startsWith(PREFIX));
  let fd: number | undefined;
  try {
    const path = config.chatgptWeb.catalogPath;
    if (!isAbsolute(path)) throw new Error("catalogPath must be absolute");
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Invalid catalog file");
    const document = JSON.parse(readFileSync(fd, "utf8"));
    if (document.version !== 1 || document.service !== "codex-chatgpt-web"
      || document.baseUrl !== config.chatgptWeb.baseUrl.replace(/\/$/, "")
      || !Array.isArray(document.models) || document.models.length > 32) throw new Error("Invalid catalog contract");
    const seen = new Set<string>();
    const web = document.models.map((row: RawEntry) => {
      if (!row || typeof row.slug !== "string" || !/^chatgpt-web\/[a-z0-9-]+$/.test(row.slug)
        || seen.has(row.slug) || !Array.isArray(row.supported_reasoning_levels)
        || typeof row.context_window !== "number" || row.context_window <= 0) throw new Error("Invalid Web model row");
      seen.add(row.slug);
      const rank = config.subagentModels?.indexOf(row.slug) ?? -1;
      return { ...row, [OWNER]: true, supports_websockets: false,
        ...(rank >= 0 ? { priority: rank, opencodex_spawn_priority: rank } : {}),
        ...(config.disabledModels?.includes(row.slug) ? { visibility: "hide" } : {}) };
    });
    return [...native, ...web];
  } catch {
    // Missing/stale export must not take Gemini or native Codex out of service.
    console.warn("[opencodex] ChatGPT Web catalog missing or invalid; Web models omitted");
    return native;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
