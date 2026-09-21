import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { saveConfig } from "../../src/config";
import { startServer } from "../../src/server";
import { installIsolatedCodexHome } from "../helpers/isolated-codex-home";
import type { OcxConfig } from "../../src/types";

// Optional two-repository contract test. Browser/model adapters are simulated; both servers are real.
const source = process.env.CHATGPT_WEB_SOURCE;
const integrationTest = source ? test : test.skip;

integrationTest("two real servers preserve Web tools, images, continuation and compact alongside another provider", async () => {
  const root = mkdtempSync(join(tmpdir(), "cohabitation-"));
  const isolated = installIsolatedCodexHome("cohabitation-codex-");
  const oldOcx = process.env.OPENCODEX_HOME, oldWeb = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.OPENCODEX_HOME = join(root, "ocx"); process.env.CODEX_CHATGPT_WEB_HOME = join(root, "web");
  const webServerModule = await import(resolve(source!, "src/server.ts"));
  const webConfigModule = await import(resolve(source!, "src/config.ts"));
  const webBackend = await import(resolve(source!, "src/opencodex-backend.ts"));
  let gateway: ReturnType<typeof startServer> | undefined;
  let web: ReturnType<typeof Bun.serve> | undefined;
  let other: ReturnType<typeof Bun.serve> | undefined;
  const seen: any[] = [];
  try {
    const templatePath = join(root, "native-template.json");
    writeFileSync(templatePath, JSON.stringify({ models: [{ slug: "gpt-5.6-sol", visibility: "list",
      supported_reasoning_levels: [{ effort: "high", description: "High" }], tool_mode: "code_mode_only",
      priority: 1, context_window: 300_000, multi_agent_version: "v1" }] }));
    const cfg = { ...webConfigModule.defaultConfig("browser-only"), integrationMode: "opencodex",
      opencodexTemplatePath: templatePath, solAvailable: true, port: 0 };
    web = webServerModule.startServer(cfg, { adapterFactory: () => ({ name: "simulated-browser",
      async runTurn(parsed: any, _incoming: unknown, emit: (event: unknown) => void) {
        seen.push(structuredClone(parsed));
        if (parsed._compactionRequest) emit({ type: "text_delta", text: "Simulated checkpoint retaining the request", phase: "final_answer" });
        else if (seen.length === 1) {
          emit({ type: "tool_call_start", id: "call_simulated", name: "inspect_file" });
          emit({ type: "tool_call_delta", arguments: '{"path":"example.txt"}' });
          emit({ type: "tool_call_end" });
        } else emit({ type: "text_delta", text: "Simulated Web continuation", phase: "final_answer" });
        emit({ type: "done", stopReason: "stop", endTurn: true });
      },
    }) });
    webBackend.publishOpencodexCatalog({ ...cfg, port: web!.port });
    other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({
      id: "simulated-other", object: "chat.completion", model: "gemini-test",
      choices: [{ index: 0, message: { role: "assistant", content: "Simulated Gemini branch" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }) });
    const config: OcxConfig = { port: 0, hostname: "127.0.0.1", defaultProvider: "other", fastRows: false,
      multiAgentMode: "v1", providers: { other: { adapter: "openai-chat", authMode: "key", apiKey: "test-only", allowPrivateNetwork: true,
        baseUrl: `http://127.0.0.1:${other.port}/v1`, models: ["gemini-test"], defaultModel: "gemini-test", liveModels: false } },
      chatgptWeb: { baseUrl: `http://127.0.0.1:${web!.port}/v1`, catalogPath: webBackend.backendCatalogPath() } };
    saveConfig(config);
    gateway = startServer(0);
    const post = (body: unknown, path = "responses") => fetch(`http://127.0.0.1:${gateway!.port}/v1/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const tool = { type: "function", name: "inspect_file", description: "Simulated read", parameters: {
      type: "object", properties: { path: { type: "string" } }, required: ["path"] } };
    const firstInput = { type: "message", role: "user", internal_chat_message_metadata_passthrough: { turn_id: "turn-test" },
      content: [{ type: "input_text", text: "Simulated request" }, { type: "input_image", image_url: "data:image/png;base64,c2ltdWxhdGlvbg==" }] };
    const firstBody = { model: "chatgpt-web/high", stream: false, input: [firstInput], tools: [tool],
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread-test", turn_id: "turn-test" }) } };
    const [first, native] = await Promise.all([post(firstBody), post({ model: "other/gemini-test", stream: false, input: "hello" })]);
    expect(first.status).toBe(200); expect(native.status).toBe(200);
    expect(await native.text()).toContain("Simulated Gemini branch");
    const initial = await first.json();
    expect(initial.output.some((item: any) => item.type === "function_call" && item.call_id === "call_simulated")).toBe(true);
    expect(seen[0]._rawBody.input).toEqual(firstBody.input);
    expect(seen[0]._rawBody.tools).toEqual(firstBody.tools);
    const continued = await post({ ...firstBody, previous_response_id: initial.id,
      input: [{ type: "function_call_output", call_id: "call_simulated", output: "simulated contents" }] });
    expect(continued.status).toBe(200); expect(await continued.text()).toContain("Simulated Web continuation");
    expect(JSON.stringify(seen[1]._rawBody)).toContain("Simulated request");
    expect(JSON.stringify(seen[1]._rawBody)).toContain("simulated contents");
    const compact = await post({ ...firstBody, stream: false }, "responses/compact");
    expect(compact.status).toBe(200); expect(JSON.stringify((await compact.json()).output)).toContain("Simulated checkpoint retaining the request");
    const catalog = await fetch(`http://127.0.0.1:${gateway.port}/v1/models?client_version=0.0.0`);
    expect(catalog.status).toBe(200);
    const rows = (await catalog.json()).models;
    expect(rows.some((m: any) => m.slug === "chatgpt-web/high")).toBe(true);
    expect(rows.some((m: any) => m.slug === "other/gemini-test")).toBe(true);
  } finally {
    await gateway?.stop(true); web?.stop(true); other?.stop(true);
    if (oldOcx === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = oldOcx;
    if (oldWeb === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = oldWeb;
    isolated.restore(); rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
