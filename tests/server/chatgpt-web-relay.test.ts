import { afterEach, expect, test } from "bun:test";
import type { OcxConfig } from "../../src/types";
import { relayChatgptWebRequest } from "../../src/server/chatgpt-web-relay";
import { handleResponsesWithPolicyFallback } from "../../src/server/responses/policy-fallback";
import { handleResponsesCompact } from "../../src/server/responses";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
function backend(fetcher: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fetcher });
  servers.push(server);
  const config: OcxConfig = { port: 10100, defaultProvider: "google", providers: {},
    chatgptWeb: { baseUrl: `http://127.0.0.1:${server.port}/v1`, catalogPath: "/unused" } };
  return { server, config };
}
const log = () => ({ provider: "", model: "" });
function request(model = "chatgpt-web/high", extra: Record<string, unknown> = {}, path = "responses") {
  return new Request(`http://127.0.0.1:10100/v1/${path}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-only",
      "chatgpt-account-id": "test-account", "x-codex-turn-metadata": "unchanged" },
    body: JSON.stringify({ model, input: [{ role: "user", content: "bonjour",
      internal_chat_message_metadata_passthrough: { turn_id: "turn-1" } }], ...extra }),
  });
}

test("relays exact private input, tool schema, images and SSE without forwarding account auth", async () => {
  let bytes = "";
  let headers = new Headers();
  const sse = 'data: {"type":"response.completed","response":{"id":"web-only"}}\n\n';
  const { config } = backend(async req => {
    bytes = await req.text(); headers = req.headers;
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  });
  const req = request(undefined, { tools: [{ type: "custom", name: "apply_patch", format: { type: "text" } }],
    previous_response_id: "web-prior", metadata: { image: "data:image/png;base64,c2ltdWxhdGlvbg==" } });
  const expected = await req.clone().text();
  const res = await handleResponsesWithPolicyFallback(req, config, log(), {}, {
    runCore: async () => { throw new Error("must bypass provider translation"); },
  });
  expect(res.status).toBe(200); expect(await res.text()).toBe(sse); expect(bytes).toBe(expected);
  expect(headers.get("authorization")).toBeNull(); expect(headers.get("chatgpt-account-id")).toBeNull();
  expect(headers.get("x-codex-turn-metadata")).toBe("unchanged");
});

test("routes compact to the real compact facade with private fields preserved", async () => {
  let seen = "";
  const { config } = backend(async req => {
    seen = new URL(req.url).pathname;
    expect((await req.json()).input[0].internal_chat_message_metadata_passthrough.turn_id).toBe("turn-1");
    return Response.json({ output: [{ type: "compaction", encrypted_content: "web-checkpoint" }] });
  });
  const res = await handleResponsesCompact(request(undefined, {}, "responses/compact"), config, log());
  expect(res.status).toBe(200); expect(seen).toBe("/v1/responses/compact"); await res.text();
});

test("Gemini and native requests still use their existing path, concurrently with Web", async () => {
  const { config } = backend(() => Response.json({ via: "web" }));
  const results = await Promise.all(["chatgpt-web/high", "google-antigravity/gemini-test", "gpt-5.6-sol"].map(model =>
    handleResponsesWithPolicyFallback(request(model), config, log(), {}, {
      runCore: async req => Response.json({ via: (await req.json()).model }),
    }).then(r => r.json())));
  expect(results).toEqual([{ via: "web" }, { via: "google-antigravity/gemini-test" }, { via: "gpt-5.6-sol" }]);
});

test("Web refusal, redirect, invalid target and dead backend never invoke another provider", async () => {
  for (const status of [429, 503, 307]) {
    const { config } = backend(() => new Response("busy", { status, headers: { location: "https://example.invalid" } }));
    const res = await handleResponsesWithPolicyFallback(request(), config, log(), {}, {
      runCore: async () => { throw new Error("quota fallback forbidden"); },
    });
    expect(res.status).toBe(status === 307 ? 502 : status); await res.text();
  }
  const { config, server } = backend(() => new Response("unused"));
  server.stop(true);
  expect((await relayChatgptWebRequest(request(), config, log()))!.status).toBe(502);
  config.chatgptWeb!.baseUrl = "http://127.0.0.1:10100/v1";
  expect((await relayChatgptWebRequest(request(), config, log()))!.status).toBe(503);
  config.chatgptWeb!.baseUrl = "https://example.invalid/v1";
  expect((await relayChatgptWebRequest(request(), config, log()))!.status).toBe(503);
});

test("compressed bodies are inspected without altering forwarded bytes", async () => {
  const data = Bun.zstdCompressSync(await request().text());
  let received: Uint8Array | undefined;
  const { config } = backend(async req => {
    expect(req.headers.get("content-encoding")).toBe("zstd");
    received = new Uint8Array(await req.arrayBuffer()); return new Response("ok");
  });
  const req = new Request("http://127.0.0.1:10100/v1/responses", {
    method: "POST", headers: { "content-encoding": "zstd" }, body: data,
  });
  expect(await (await relayChatgptWebRequest(req, config, log()))!.text()).toBe("ok");
  expect(received).toEqual(new Uint8Array(data));
});

test("cancelling the downstream stream aborts the upstream request", async () => {
  let cancelled = false;
  const { config } = backend(req => {
    req.signal.addEventListener("abort", () => { cancelled = true; });
    return new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode("data: first\n\n")); },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "text/event-stream" } });
  });
  const response = (await relayChatgptWebRequest(request(), config, log()))!;
  const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
  for (let i = 0; !cancelled && i < 40; i++) await Bun.sleep(10);
  expect(cancelled).toBe(true);
});
