import type { OcxConfig } from "../types";
import type { RequestLogContext } from "./request-log";
import { readJsonRequestBody, resolveInboundBodyLimitBytes } from "./request-decompress";

/** A harness backend, not a generic Responses provider: its private wire must survive intact. */
export function chatgptWebBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.search || url.hash
    || !/^\/v1\/?$/.test(url.pathname)) {
    throw new Error("chatgptWeb.baseUrl must be http://127.0.0.1:PORT/v1");
  }
  return url;
}

const FORWARDED_HEADERS = [
  "content-type", "content-encoding", "user-agent", "originator",
  "session_id", "session-id", "thread-id", "x-client-request-id",
  "x-codex-turn-metadata", "x-codex-turn-state", "x-codex-parent-thread-id",
];

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { type: "chatgpt_web_unavailable", message } }, { status });
}

export async function relayChatgptWebRequest(
  req: Request,
  config: OcxConfig,
  log: RequestLogContext,
  options: { abortSignal?: AbortSignal; onRequestBodyRead?: () => void } = {},
): Promise<Response | null> {
  if (!config.chatgptWeb) return null;
  let body: unknown;
  try {
    body = await readJsonRequestBody(req.clone(), undefined, resolveInboundBodyLimitBytes(config.maxInboundBodyBytes));
  } catch {
    return errorResponse(400, "Cannot read the Responses request");
  }
  const model = body && typeof body === "object" ? (body as { model?: unknown }).model : undefined;
  if (typeof model !== "string" || !model.startsWith("chatgpt-web/")) return null;
  options.onRequestBodyRead?.();
  log.requestedModel = model;
  log.model = model;
  log.provider = "chatgpt-web";
  const incoming = new URL(req.url);
  if (req.method !== "POST" || !["/v1/responses", "/v1/responses/compact"].includes(incoming.pathname)) {
    return errorResponse(400, "Unsupported ChatGPT Web endpoint");
  }
  let destination: URL;
  try {
    destination = chatgptWebBaseUrl(config.chatgptWeb.baseUrl);
    if (destination.port === String(config.port) || destination.origin === incoming.origin) {
      throw new Error("Recursive route");
    }
  } catch {
    return errorResponse(503, "Invalid or recursive ChatGPT Web route");
  }
  destination.pathname = incoming.pathname;
  destination.search = incoming.search;
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Web inference uses the backend's browser session; never forward Codex account credentials.
  const abort = new AbortController();
  const signals = [req.signal, abort.signal, ...(options.abortSignal ? [options.abortSignal] : [])];
  const timer = setTimeout(() => abort.abort(new Error("ChatGPT Web response headers timed out")), 30_000);
  try {
    const transport: RequestInit & { proxy: string } = { proxy: "" };
    const upstream = await fetch(new Request(destination, {
      method: "POST", headers, body: req.body, signal: AbortSignal.any(signals), redirect: "manual",
    }), transport);
    clearTimeout(timer);
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return errorResponse(502, "ChatGPT Web redirects are refused");
    }
    if (!upstream.body) return new Response(null, { status: upstream.status, headers: upstream.headers });
    const reader = upstream.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { reader.releaseLock(); controller.close(); }
          else controller.enqueue(value);
        } catch (error) { abort.abort(error); controller.error(error); }
      },
      async cancel(reason) { abort.abort(reason); await reader.cancel(reason).catch(() => {}); },
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of ["connection", "transfer-encoding", "content-length", "content-encoding", "set-cookie"]) responseHeaders.delete(name);
    return new Response(stream, { status: upstream.status, headers: responseHeaders });
  } catch {
    abort.abort();
    return errorResponse(502, "ChatGPT Web is unavailable; no other provider was used");
  } finally {
    clearTimeout(timer);
  }
}
