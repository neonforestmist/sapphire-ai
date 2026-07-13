# SapphireAI QA report

Last updated: 2026-07-13

## Verification status

The flagship rate-limiter contradiction flow is implemented and verified in two deterministic environments:

- locally through the complete browser journey; and
- through the private Cloud Run service while using the real Firestore and Cloud Storage adapters.

Both deployed Playwright cases passed through an authenticated Cloud Run proxy, including deletion. The deployed test left zero Firestore session documents and no Cloud Storage objects. The final service was then restored to real Gemini mode.

The final private revision serves 100% of traffic. Its authenticated health response is HTTP 200 and reports `providerMode: real`, `persistenceMode: firestore`, and `liveEnabled: false`. An unauthenticated request returns HTTP 403. Exact private cloud identifiers are intentionally omitted from this public report.

A successful real Gemini reasoning response is not yet verified. A bounded smoke reached `gemini-3.5-flash` but returned transient HTTP 500 high-demand errors; a later bounded smoke returned HTTP 429 Free Tier rate-limit errors. These are recorded as provider-capacity/quota limitations, not as a passing analysis test. No Gemini billing or top-up was enabled.

## Environment evidence

| Item | Observed result |
| --- | --- |
| Repository | Public source tree; private drafts and internal build instructions are excluded |
| Node.js | 25.9.0 installed locally; project target and container base are Node.js 24 LTS |
| pnpm | 11.7.0 |
| Browser | Installed Google Chrome used by Playwright and rendered QA |
| Google Cloud CLI | Google Cloud SDK 575.0.1 authenticated for the selected project |
| Runtime project | Private application project in `us-central1` |
| Runtime billing | Google Cloud Free Trial; no full-account activation was performed |
| Gemini API project | Separate private project; billing disabled and Free Tier limits observed |
| Cloud Run | Private service `sapphireai`; verified revision at 100% traffic |
| Firestore | Native `(default)` database in `us-central1`, free tier enabled, delete protection enabled |
| Cloud Storage | Private snapshot bucket; public access prevention and uniform access enabled |
| Artifact Registry | Private `sapphireai` Docker repository with an active bounded cleanup policy |
| Runtime identity | Dedicated runtime service account |
| Runtime secrets | Secret Manager pins `GEMINI_API_KEY` and `SESSION_SIGNING_SECRET` to numeric versions; no secret value is stored in source or listed here |
| Public access | Intentionally not enabled |

## Required commands and deployment checks

The full local gate passed on 2026-07-13.

| Command or check | Result | Evidence |
| --- | --- | --- |
| `pnpm install` | Pass | Lockfile present; dependency installation and postinstall completed |
| `pnpm lint` | Pass | ESLint exited 0 on the final source tree |
| `pnpm typecheck` | Pass | Strict `tsc --noEmit` exited 0 |
| `pnpm test` | Pass | 71 Vitest unit/integration tests passed |
| `pnpm test:e2e` | Pass | 2 local Playwright flagship tests passed |
| `pnpm build` | Pass | Next.js production build compiled, typechecked, generated routes, and exited 0 |
| `pnpm audit --prod --audit-level high` | Pass | No known production vulnerabilities after pinned transitive security upgrades |
| Cloud Build | Pass | Final patched build succeeded |
| Authorized Cloud Run health | Pass | HTTP 200; real provider, Firestore persistence, Live disabled |
| Unauthenticated Cloud Run health | Pass | HTTP 403; private invocation policy is enforced |
| Deployed deterministic E2E | Pass | 2 Playwright tests passed through the authenticated Cloud Run proxy against Firestore and Cloud Storage |
| Post-E2E cleanup | Pass | Firestore session count was 0 and the snapshot bucket contained no objects |
| Real Gemini smoke | Inconclusive | Bounded runs reached `gemini-3.5-flash`; one returned transient HTTP 500 responses and a later run returned HTTP 429 Free Tier rate-limit responses |
| Real Gemini Live smoke | Not run | Browser Live transport is unfinished and `ENABLE_GEMINI_LIVE=false` |
| `git diff --check` | Pass | Exited 0 after the final documentation update |

Playwright uses Next's supported Webpack development mode for its disposable local server. A prior Turbopack-only development-bundle failure did not reproduce in the production build or the deployed service.

## Flagship acceptance evidence

| Step | Local deterministic | Deployed deterministic | Observed evidence |
| --- | --- | --- | --- |
| Landing and setup | Pass | Pass | Focused dark sapphire interface with no unnecessary eyebrow copy |
| Explicit consent | Pass | Pass | Enter action remains disabled until consent; anonymous session starts afterward |
| Rate-limiter brief | Pass | Pass | One globally distributed API rate-limiter prompt |
| Initial board | Pass | Pass | US API to US Redis and EU API to EU Redis with stable IDs |
| Scene normalization and diff | Pass | Pass | Stable normalized element IDs and bounded board snapshots persist through analysis |
| Finalized global claim | Pass | Pass | Typed transcript is persisted as finalized evidence |
| Structured board analysis | Pass | Pass | Deterministic gateway returns schema-valid reasoning with an analysis version |
| Unknown-ID defense | Pass | Pass | Invented model IDs are rejected or downgraded before focus and persistence |
| Exact focus | Pass | Pass | Exactly US Redis and EU Redis are selected; the focus legend names both |
| Grounded probe | Pass | Pass | Probe ties global consistency to disconnected regional stores and double consumption |
| Revision | Pass | Pass | Global quota coordinator and synchronization paths are added |
| Revision recognition | Pass | Pass | Evidence changes to revision recognized and the coordinator receives focus |
| Report | Pass | Pass | Report defaults to the contradiction and links the exact evidence IDs |
| Replay | Pass | Pass | Initial and revised snapshots plus finalized transcripts are preserved |
| Deletion | Pass | Pass | Subsequent access is denied; deployed Firestore and Storage artifacts are removed |

## Rendered interface QA

The optimized production UI was checked in Chrome at desktop and mobile sizes. The verified journey includes:

- landing hierarchy, setup, consent gating, and text-mode selection;
- all initial rate-limiter nodes and arrows fitting in the Excalidraw camera;
- exact `US Redis + EU Redis` contradiction focus without hiding the surrounding topology;
- evidence-grounded probe, coordinator revision, and revision-recognized state;
- report defaulting to the contradiction evidence;
- replay preserving the complete multiline `Global quota coordinator` label;
- visible keyboard focus and honest disabled voice state; and
- a 390 by 844 viewport with no horizontal overflow and a 44 px primary action.

No unexplained browser console error was observed in the inspected local journey. Because the Cloud Run service is intentionally private, deployed browser automation used an authenticated local proxy instead of a public URL.

## Cloud deployment evidence

The final service configuration was read back after deployment:

- one maximum instance at both service and revision scope, with zero minimum instances;
- CPU throttling enabled, 1 vCPU, and 1 GiB memory;
- the dedicated runtime service account rather than a default user credential;
- Firestore persistence with the private Cloud Storage snapshot bucket;
- numeric Secret Manager version references for both Gemini and session-signing credentials;
- real Gemini gateway selected and Gemini Live intentionally disabled; and
- private invocation only.

Artifact Registry cleanup deletes old images while retaining a small recent set. Firestore delete protection is enabled, Cloud Storage public access prevention is enforced, and the application cleanup test removed all session evidence it created.

## Security and safety evidence

- External and model-generated data are parsed with strict Zod schemas.
- Anonymous ownership uses an HttpOnly SameSite capability with canonical signature validation.
- Mutation origin, request-size, rate, concurrency, and stale-analysis controls are tested.
- Unknown board IDs are rejected before focus or persistence.
- Model text is rendered as text, not trusted HTML.
- Permanent Gemini and Google Cloud credentials are never exposed client-side.
- Raw microphone audio is not captured or stored by the current build.
- The runtime service account has scoped Firestore, bucket-object, and secret-access roles.
- The service is private; unauthenticated invocation was verified to fail with HTTP 403.
- No secret value appears in this report or the repository.

## Gemini verification

The implementation targets `gemini-3.5-flash` through `@google/genai` 2.11.0, using the Interactions API and a JSON Schema response format. Deterministic demo blueprint generation preserves the small Free Tier request budget, while board analysis remains a real provider operation in real mode. A final-report fallback is limited to transient provider failure and labels its limitation in the report; board analysis never silently falls back.

Credential routing and request authentication were sufficient to reach the real model. The final smokes did not yield a model response because the provider returned transient HTTP 500 high-demand and later HTTP 429 Free Tier rate-limit errors. The separate Gemini API project remains unbilled. Therefore:

- real API connectivity and model selection are observed;
- a successful real structured board analysis is not claimed; and
- no billing activation or credit top-up is required to keep the current private deployment available.

## Remaining verification

- Repeat the opt-in real Gemini smoke after provider capacity recovers; require a schema-valid response before claiming real reasoning success.
- Implement and verify the browser Gemini Live transport before enabling `ENABLE_GEMINI_LIVE`.
- Exercise arbitrary freehand pan, zoom, resize, and deletion combinations beyond the deterministic signature board.
- If public access is ever desired, obtain separate explicit approval, review abuse controls, and then repeat the deployed clean-browser and unauthenticated-access tests.
