---
title: ChatGPT Web coexistence
description: Use the optional ChatGPT Web backend alongside OpenCodex providers without competing Codex configuration writers.
---

This fork adds an opt-in local backend for `chatgpt-web/*`. OpenCodex remains the only writer
of Codex's `openai_base_url` and shared model catalog. Gemini and native models keep their routes.

## Prepare both forks

Use the matching codex-chatgpt-web fork with its `integration opencodex` command. Keep its normal
browser and MCP setup. Full coding tools still require that project's existing full-mode setup;
this integration does not manufacture a login, account entitlement or connector.

Start OpenCodex once so its `opencodex-catalog.json` exists. Then, from the Web fork:

```sh
bun run src/cli.ts integration opencodex --template /absolute/path/to/.codex/opencodex-catalog.json
```

The command exports Web model metadata and prints the `chatgptWeb` object to add to OpenCodex's
existing config. It changes only the Web project's private config and export; it does not change
Codex's route or stop either service. A typical OpenCodex fragment is:

```json
{
  "chatgptWeb": {
    "baseUrl": "http://127.0.0.1:17841/v1",
    "catalogPath": "/absolute/path/to/.codex-chatgpt-web/opencodex-models.json"
  }
}
```

Merge this fragment into the existing configuration; do not replace `providers` or credentials.
Use the patched Web launcher/runtime, not a previously installed upstream executable. Restart the
Web backend and then restart or refresh OpenCodex. Restart Codex and begin a fresh task so its
picker and tool roster load the shared catalog. The Web export is regenerated on backend start
and account-capability setup; repeat the OpenCodex refresh after such changes.

There is no dashboard integration toggle yet. For cross-backend subagents, use OpenCodex's V1
mode together with the Web backend's `compatibility-v1` setting. Web slugs can appear in
`subagentModels`; Codex's existing five-model delegation limit still applies. Encrypted native
V2 task delivery is not translated by this relay.

## Behavior and limits

- Web Responses and compact requests use the Web backend without generic provider rewrites.
- Streams, images, tool calls, private turn metadata and `previous_response_id` are preserved.
- A failed Web backend returns its error or a local 502; there is no fallback to Codex inference.
- Browser and MCP execution remain owned by codex-chatgpt-web and retain their existing limits.
- Web catalog rows advertise HTTP, not WebSocket inference. Native and Gemini transports are unchanged.
- The relay does not send Codex OAuth tokens to the Web backend. Separate native features and native
  tasks can still use Codex; coexistence does not guarantee account-wide zero Codex usage.
- The model file is read at catalog refresh/request time. No automatic export-file watcher is installed.
- Run matching fork versions. Reinstalling upstream releases can remove these changes.

## Rollback

Remove only the `chatgptWeb` block from OpenCodex's config, then refresh/restart OpenCodex and Codex.
Its owned Web rows disappear while existing providers remain configured. Stopping or removing the
patched Web backend does not restore an old Codex route. To later make Web the standalone owner,
run `integration standalone` and explicitly reconnect/setup that route using the normal conflict checks.

## Validation

Focused relay/catalog tests use local simulated endpoints. To exercise both real servers with
simulated model adapters, run from this fork:

```sh
CHATGPT_WEB_SOURCE=/absolute/path/to/codex-chatgpt-web bun test tests/server/chatgpt-web-integration.test.ts
```

This checks transport coexistence, tools, image input, continuation and compaction without an
account call. Verify the actual Codex picker, browser tools and interruption behavior separately
before using the patched processes for normal tasks.
