# SapphireAI implementation plan

Last updated: 2026-07-13

## Objective and completion rule

SapphireAI is a multimodal interview practice application with a whiteboard-native system-design path. Its controlling acceptance path is:

1. the candidate states that quotas must remain globally consistent;
2. the board shows separate US and EU API-to-Redis paths without synchronization;
3. the reasoning gateway returns a schema-valid contradiction grounded in the finalized transcript and exact current board IDs;
4. the application focuses exactly the two Redis elements and asks a relevant probe;
5. the candidate adds a global coordination path;
6. reanalysis recognizes the revision; and
7. the report and replay preserve the decision, contradiction, probe, revision, transcript IDs, board IDs, and snapshots.

That path is complete and verified with the deterministic gateway both locally and through the private Cloud Run service using Firestore and Cloud Storage. A successful real `gemini-3.5-flash` analysis remains an external verification item: credentialed bounded runs reached the model but returned transient HTTP 500 high-demand and HTTP 429 Free Tier rate-limit responses.

The deployed service is intentionally private. Public access and Gemini Live remain disabled in Cloud Run unless separately approved. The local browser transport passed a bounded Free Tier typed-to-audio turn and a synthetic-microphone capture check.

## Dependency order

~~~text
Schemas and state machine
        |
        v
Board normalization, stable IDs, and semantic diff
        |
        v
Gateway, persistence, APIs, ownership, and safety
        |
        v
Exact focus, contradiction probe, report, and replay
        |
        v
Local deterministic flagship E2E
        |
        v
Private Cloud Run + Firestore/Storage flagship E2E
        |
        +----> Successful real Gemini reasoning smoke (provider capacity pending)
        +----> Browser Gemini Live real-provider smoke (local implementation complete)
~~~

## P0 - flagship whiteboard contradiction flow

Status: complete for deterministic acceptance; real-provider response verification remains pending.

### Implemented

- [x] Current stable Next.js App Router, strict TypeScript, pnpm, Tailwind, Zod, Excalidraw, Vitest, Testing Library, and Playwright.
- [x] Explicit mock and real configuration with server-only credentials and actionable real-mode validation.
- [x] Strict Zod schemas for board scenes, diffs, transcripts, events, stages, reasoning, evidence, reports, APIs, and errors.
- [x] Validated interview setup for system design, technical explanation, case study, and behavioral practice, with one fully verified system-design problem pack.
- [x] Excalidraw as the primary workspace with stable element IDs, normalized geometry, bindings and deletion state, semantic diffs, bounded snapshots, and analysis versions.
- [x] Append-only evidence linking transcripts, snapshots, reasoning, focus, probes, revisions, completion, and reports.
- [x] Real and deterministic Gemini gateways behind one contract.
- [x] Gemini 3.5 Flash Interactions request shape with text and image input plus JSON Schema response format.
- [x] Strict parsing, one repair attempt, bounded transient retry, confidence policy, stale-version protection, unknown-ID rejection, and plain-text rendering.
- [x] Demo-mode deterministic blueprint generation so the limited Free Tier request budget is reserved for board analysis.
- [x] Honest deterministic final-report fallback only for transient provider failure; real board analysis never silently falls back.
- [x] Required interview, event, analysis, finish, report, snapshot, deletion, Live-token, and health routes.
- [x] Memory and Firestore/Storage repositories plus anonymous ownership capability, origin/body/rate/concurrency protections, consent, and complete deletion.
- [x] Landing, setup, optional board, mixed text/audio controls, exact focus and keyboard reveal, report, replay, loading/error/not-found states, and deterministic text fallback.
- [x] Report defaults to the contradiction evidence and replay preserves multiline board labels and supported shapes.
- [x] Polished dark sapphire interface with responsive collapse, reduced motion, visible focus, honest feature states, and no unnecessary eyebrow copy.

### Verified acceptance

- [x] 79 unit/integration tests cover schemas, browser-speech text/error handling, audio conversion, state, board normalization/diff, provider parsing and safety, interview-brief validation, ownership/security, persistence, Live tools/state, and orchestration.
- [x] Three local Playwright cases cover responsive landing, consent, conversation, browser-voice availability, automatic board-idle analysis, exact Redis focus, grounded probe, coordination revision, report, replay, deletion, and subsequent denial.
- [x] Two deployed Playwright cases repeat the flagship journey through an authenticated Cloud Run proxy with Firestore and Cloud Storage.
- [x] Deployed deletion leaves zero Firestore sessions and no bucket objects.
- [x] Production Chrome QA verifies landing, setup, consent, board fit, exact contradiction focus, revision, default report evidence, replay, and mobile overflow.
- [x] Required local commands pass: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and `pnpm build`.
- [ ] Real Gemini returns a schema-valid structured board analysis. Bounded runs reached `gemini-3.5-flash` but returned transient HTTP 500 and later HTTP 429 responses.
- [ ] Extended interaction QA covers arbitrary freehand pan, zoom, resize, and deletion beyond the deterministic board.

## P1 - interviewer transport and resilient fallback

Status: the local browser transport and independent text path are implemented and passed bounded real-provider checks. Deployed enablement remains pending.

### Complete

- [x] Deterministic text interviewer remains independent of Live availability.
- [x] Server-created, short-lived ephemeral-token boundary constrained to the configured Live model and server-owned instructions.
- [x] Exactly seven strict Live tool schemas and an application-owned dispatcher with matching call IDs, bounded sanitized responses, and unknown board-ID rejection.
- [x] Pure connection-state reducer covering interruption, queued playback clearing, GoAway, resumption handles, compression, bounded recovery, and failure.
- [x] Dispatcher and reducer tests.
- [x] One multimodal room accepts typed turns and microphone audio without an upfront mode choice.
- [x] The room presents persisted candidate and interviewer turns as one recognizable conversation, beginning with the interviewer's question.
- [x] Microphone starts muted and is requested only after the user selects unmute.
- [x] When Gemini Live is disabled, supported browsers provide opt-in speech recognition and question read-aloud without requiring Gemini credentials.
- [x] Browser capture resamples mono audio to 16 kHz PCM16, sends realtime chunks, plays 24 kHz output, clears playback on interruption, and persists finalized input/output captions.
- [x] Typed turns remain usable while Live connects or fails and can receive spoken Live output when enabled.
- [x] Whiteboard can be shown or hidden without leaving the interview.
- [x] Once a finalized candidate turn exists, each new meaningful board edit automatically requests analysis after a 1.6-second drawing pause; version guards prevent duplicate analysis.
- [x] Live board-analysis, exact-focus, and reflection tool calls pass through the validated application dispatcher. Unsupported state mutations return bounded application-owned failures.
- [x] Bounded real Live typed-to-audio check returned native audio and a finalized output caption without enabling billing.
- [x] Opt-in Chrome check used a synthetic microphone, verified the muted default, then entered listening and streamed only after unmute.
- [x] Deployed runtime explicitly uses `ENABLE_GEMINI_LIVE=false`.

### Remaining Live work

- [ ] Networked interruption, GoAway, resumption, and reconnect execution.
- [ ] Mock Live transport integration and rendered microphone/reconnect QA.

The repository claims a bounded local real-provider Live verification, not deployed Live availability or long-session resilience. The complete credential-free acceptance path remains text plus direct board analysis.

## P2 - Google Cloud and private deployment

Status: complete for the approved private, scale-to-zero deployment; public exposure is intentionally out of scope.

### Complete

- [x] The private Google Cloud application project is configured in `us-central1`; its identifier is intentionally omitted from public documentation.
- [x] Required Cloud Run, Cloud Build, Artifact Registry, Firestore, Storage, Secret Manager, IAM, API Keys, and Gemini APIs enabled.
- [x] Firestore Native `(default)` database configured with free tier and delete protection.
- [x] Private Cloud Storage snapshot bucket configured with uniform access and public access prevention.
- [x] Dedicated runtime service account with scoped Firestore, bucket-object, and secret-access roles.
- [x] Gemini and session-signing credentials stored in Secret Manager and pinned to numeric versions.
- [x] Node.js 24 multi-stage non-root container built successfully by Cloud Build.
- [x] Production dependency audit reports no known vulnerabilities after pinned transitive security upgrades.
- [x] Private Cloud Run service deployed; the verified revision serves 100% of traffic.
- [x] Runtime capped at zero minimum and one maximum instance, CPU throttled, 1 vCPU, and 1 GiB memory.
- [x] Authenticated health returns HTTP 200 with real provider and Firestore persistence; unauthenticated health returns HTTP 403.
- [x] Deployed deterministic flagship E2E passes both cases against Firestore and Cloud Storage, including complete deletion.
- [x] Post-test persistence audit confirms zero Firestore sessions and no bucket objects.
- [x] Artifact Registry cleanup policy is active and retains only a bounded recent image set.
- [x] Deployment helper defaults remain private, scale-to-zero, one maximum instance, CPU throttling, numeric secret pins, and Live disabled.
- [x] Architecture, Gemini, cloud, privacy, and QA documents reflect the implemented system.

### Remaining and optional hardening

- [ ] Repeat the real Gemini smoke after provider capacity recovers and record one schema-valid analysis response.
- [ ] Replace process-local request limiting with a distributed limiter before increasing Cloud Run beyond one instance.
- [ ] Run broader freehand-board and long-session persistence tests.
- [ ] Verify Gemini Live against the real Preview service before considering it for deployment; keep `ENABLE_GEMINI_LIVE=false` until then.
- [ ] If public access is desired later, require separate explicit approval, abuse-control review, and a new public clean-browser test.

## External limits and approval gates

| Capability | Current evidence | Next action |
| --- | --- | --- |
| Real Gemini reasoning | Authentication reached `gemini-3.5-flash`; bounded runs returned transient HTTP 500 high-demand and HTTP 429 Free Tier rate-limit responses | Retry after provider capacity/quota recovers; do not claim success until a structured response validates |
| Gemini Free Tier | Separate Gemini project is unbilled; an earlier request observed its HTTP 429 Free Tier limit | Keep request volume bounded; do not add a top-up merely for the demo |
| Real Gemini Live | Typed input produced native audio and a finalized caption; synthetic microphone capture reached listening after unmute; deployment flag is false | Keep deployment disabled until reconnect and longer-session behavior are verified |
| Google Cloud runtime | Private revision healthy and deterministic deployed E2E passed | Keep Free Trial safeguards and one-instance cap unless the owner explicitly changes the operating model |
| Public exposure | Intentionally not enabled; unauthenticated invocation returns HTTP 403 | Obtain separate explicit approval before granting `allUsers` invocation |
| Billing activation | Not required for the current approved state | Do not click **Activate** or enable a paid Gemini tier as part of routine verification |

Public exposure, broader IAM, scaling above one instance, billing activation, destructive cloud teardown, and repository publishing remain explicit owner decisions.

## Explicit non-goals

Do not add resumes, job matching, accounts, payments, employer workflows, facial or emotion analysis, culture-fit inference, generic chat, or an in-product autonomous browser agent. Additional interview formats remain bounded interview-practice modes. Only system design currently has a verified board-contradiction fixture and evidence path.
