# ChatGPT Web coexistence

The optional `chatgptWeb` block gives OpenCodex ownership of Codex routing while a separate
codex-chatgpt-web process owns browser inference. No provider entry is required or synthesized.
`src/types/config.ts` declares the opt-in block; `src/config/schema/config-schema.ts` validates it.

`src/server/chatgpt-web-relay.ts` intercepts only `chatgpt-web/*` requests before the generic
Responses adapter. `src/server/responses/policy-fallback.ts` and `src/server/responses.ts`
apply it to Responses and compact respectively, after the HTTP admission layer.
The existing WebSocket-to-HTTP bridge can reach the same handler; exported Web rows advertise
HTTP only. No hosted search or vision sidecar, retry, combo or quota fallback runs on this path.
The body, model slug, private message metadata, tools and images survive unchanged, including
compressed requests. Only allowlisted transport headers cross to the local backend; Codex OAuth
and account headers do not. The backend uses its own authenticated browser profile.

The endpoint is an explicit HTTP IPv4 loopback URL. Self-routes and redirects are refused.
An empty Bun proxy override prevents environment proxy settings from exporting the local request.
Cancellation propagates through both the request signal and downstream stream cancellation.
Header acquisition has a 30-second deadline; the backend owns inference's existing stall watchdog.
No inference is replayed after an HTTP error or interrupted stream.

`src/codex/catalog/chatgpt-web.ts` consumes the backend-owned `opencodex-models.json` export.
Its version-1 envelope identifies the service, exact backend base URL and model rows. Only
unique `chatgpt-web/*` slugs are accepted, with bounded file size and row count. The merge runs
in retained synchronization, management convergence and the Codex-shaped HTTP model list.
It preserves non-Web entries, marks its own rows, applies visibility and featured subagent
priorities, and removes owned rows when disabled. An absent or invalid export omits Web rows
and emits a content-free warning; Gemini and native routes remain available. Files are reread
at the next catalog request/refresh; this feature installs no watcher or persistent cache.

The backend exports after account-capability setup and at server startup. OpenCodex refreshes
its shared catalog afterwards. This explicitly ordered file exchange avoids giving a Web-only
metadata reader a Codex OAuth token or requiring network inference during configuration.
Neither component changes the other's configuration. Cross-backend delegation uses the
operator-selected V1 surface; encrypted native V2 task payloads remain unsupported by the Web backend.

`tests/server/chatgpt-web-relay.test.ts` and `tests/codex-integration/chatgpt-web-catalog.test.ts`
cover relay and merge behavior. `tests/server/chatgpt-web-integration.test.ts` optionally exercises
both real HTTP servers against simulated adapters when `CHATGPT_WEB_SOURCE` points to the second
fork. This test is not evidence of a live browser, account entitlement, quota billing or native
Codex picker behavior. See the public coexistence guide for the activation and rollback sequence.


## Verification record — 2026-09-22

Validated with Bun 1.4.0 against OpenCodex baseline
`7c625fc9755c9824653ab944190e243091a2c85c` and the matching Web fork
`41366168e7934ff00b370ec1a4bb00bdacfcd096`.

- Relay/catalog tests: 10 passed; existing policy-fallback tests: 12 passed.
- Optional two-server contract test: passed with the sibling checkout supplied through `CHATGPT_WEB_SOURCE`.
- Both projects' TypeScript checks, structure check, privacy scan and public docs build passed.
- Web backend/related focused tests passed; launcher tests: 310 passed, one skipped. The Web runtime bundle built successfully.
- The import-connected OpenCodex run recorded 22,115 passing tests, then hit its 900-second lane deadline.
  `tests/server/api-usage.test.ts` was still running; all its 33 tests passed on an isolated rerun.
  `tests/codex-integration/codex-shim-destroyed-probe.test.ts` failed its five-second timeout;
  the same failure reproduced in an untouched checkout of the baseline commit.

The expanded suite is therefore not green as a whole. No live browser account, Codex picker,
provider quota accounting or installed-service migration was exercised by these checks.
