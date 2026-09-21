import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeChatgptWebCatalog } from "../../src/codex/catalog/chatgpt-web";
import { configSchema } from "../../src/config/schema/config-schema";
import type { OcxConfig } from "../../src/types";
import type { RawEntry } from "../../src/codex/catalog/parsing";
const roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });
const row = (slug: string) => ({ slug, visibility: "list", context_window: 90_000,
  supported_reasoning_levels: [{ effort: "high", description: "High" }], tool_mode: null }) as RawEntry;
function fixture(models: RawEntry[] = [row("chatgpt-web/high")]) {
  const root = mkdtempSync(join(tmpdir(), "web-catalog-")); roots.push(root);
  const catalogPath = join(root, "models.json");
  const config: OcxConfig = { port: 10100, providers: { google: { adapter: "google", baseUrl: "https://generativelanguage.googleapis.com", authMode: "key" } }, defaultProvider: "google",
    chatgptWeb: { baseUrl: "http://127.0.0.1:17841/v1", catalogPath } };
  writeFileSync(catalogPath, JSON.stringify({ version: 1, service: "codex-chatgpt-web", baseUrl: config.chatgptWeb!.baseUrl, models }));
  return config;
}
test("adds Web once without altering Gemini or native capabilities", () => {
  const config = fixture(); const source = [row("gpt-5.6-sol"), row("google-antigravity/gemini-test")];
  const snapshot = structuredClone(source);
  const result = mergeChatgptWebCatalog(source, config);
  expect(result.map(m => m.slug)).toEqual([...source.map(m => m.slug), "chatgpt-web/high"]);
  expect(source).toEqual(snapshot); expect(result.slice(0, 2)).toEqual(source);
  expect(result[2].supports_websockets).toBe(false);
  expect(mergeChatgptWebCatalog(result, config)).toEqual(result);
  expect(mergeChatgptWebCatalog(result, { ...config, chatgptWeb: undefined })).toEqual(source);
});
test("missing, wrong-owner, duplicate and oversized exports leave native routing available", () => {
  const native = [row("gpt-5.6-sol")];
  for (const models of [[row("gpt-evil")], [row("chatgpt-web/high"), row("chatgpt-web/high")]]) {
    expect(mergeChatgptWebCatalog(native, fixture(models))).toEqual(native);
  }
  const config = fixture();
  writeFileSync(config.chatgptWeb!.catalogPath, "x".repeat(1024 * 1024 + 1));
  expect(mergeChatgptWebCatalog(native, config)).toEqual(native);
  config.chatgptWeb!.catalogPath += ".missing";
  expect(mergeChatgptWebCatalog(native, config)).toEqual(native);
});
test("applies disabledModels and does not claim an existing generic provider while disabled", () => {
  const config = fixture(); config.disabledModels = ["chatgpt-web/high"];
  expect(mergeChatgptWebCatalog([], config)[0].visibility).toBe("hide");
  const generic = [row("chatgpt-web/custom")];
  expect(mergeChatgptWebCatalog(generic, { ...config, chatgptWeb: undefined })).toEqual(generic);
});
test("config accepts opt-in integration and rejects non-loopback endpoints", () => {
  const config = fixture();
  expect(configSchema.parse(config).chatgptWeb).toEqual(config.chatgptWeb);
  expect(configSchema.safeParse({ ...config, chatgptWeb: { ...config.chatgptWeb, baseUrl: "https://example.invalid/v1" } }).success).toBe(false);
});
