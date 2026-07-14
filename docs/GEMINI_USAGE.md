# Gemini usage

Last verified against official Google documentation: 2026-07-13

## Why Gemini is essential

SapphireAI’s signature behavior requires joint interpretation of:

- a readable whiteboard image;
- normalized scene elements with stable IDs and connector relationships;
- the semantic diff from the previous analyzed board;
- timestamped transcript claims;
- prior validated reasoning;
- the current interview stage, rubric, and active constraints.

The model must compare the candidate’s stated requirement with the evolving visual structure, return one high-value follow-up, and cite the exact element IDs that ground it. A text-only interviewer cannot provide that behavior.

Gemini recommends interpretations and actions. It does not own session authorization, stage transitions, persistence, focus rendering, confidence policy, or deletion.

## Model separation and lifecycle

| Responsibility | Model/API | Verified status |
| --- | --- | --- |
| Board/transcript reasoning, blueprint, rubric, report | `gemini-3.5-flash` through Interactions API | Model is stable and generally available |
| Conversational audio interviewer | `gemini-3.1-flash-live-preview` through Live API | Model and Live API are Preview |
| Deterministic tests and credential-free local work | `MockGeminiGateway` plus Live dispatcher/reducer fixtures | Application-owned |

Gemini 3.5 Flash does not support the Live API, so the application intentionally uses separate models. The Live model provides conversational presence; 3.5 Flash remains the authoritative structured reasoning path.

The official Gemini 3.5 Flash guide recommends `@google/genai` 2.0.0 or later for the May 2026 Interactions API changes. Pin and update the SDK deliberately, and rerun real smoke tests before accepting a version change.

### Current implementation status

- Implemented: `@google/genai` 2.11.0 reasoning gateway, deterministic mock gateway, strict Interactions parsing/repair, server ephemeral-token creation, browser Live session adapter, 16 kHz PCM microphone capture, 24 kHz playback, finalized caption persistence, seven strict Live tools, application dispatcher, and connection/recovery reducer.
- Functional today: typed text fallback and direct board analysis, independent of Live. The deployed Cloud Run service is configured with `GEMINI_MODE=real` and `ENABLE_GEMINI_LIVE=false`.
- Quota-preserving demo setup: the fixed `demo` / `global-rate-limiter` blueprint is assembled deterministically even inside `RealGeminiGateway`; it does not consume a Gemini request.
- Authoritative analysis: `analyzeBoard` in real mode always calls Gemini and never silently substitutes deterministic reasoning. A provider failure remains a visible, recoverable analysis error and the board stays usable.
- Report resilience: only a retryable/transient final-report failure may use a schema-validated deterministic report assembled from already validated evidence. That report includes the explicit limitation: “Gemini final-report generation was temporarily unavailable. This report was assembled from validated session evidence.” Authentication, permission, validation, and other non-retryable errors do not take this path.
- Verified locally: a bounded Free Tier typed turn returned 18 native-audio parts and output transcription; the rendered browser persisted and displayed the finalized caption. An opt-in Chrome check used a synthetic microphone and reached the listening state only after unmute.
- Not implemented: automatic networked reconnect and resumption execution, deterministic mock audio transport, and long-session real-provider audio verification.
- Provider state: a server-only credential is available and real requests have reached the Gemini API. The latest observed responses were Free Tier quota (`429`) and upstream high-demand (`500`) errors, so no successful real flagship analysis is claimed here. See `docs/QA_REPORT.md` for the latest smoke evidence.

### Free Tier authorization and quota boundary

The service-account-bound, Gemini-API-restricted authorization key originates in a separate authorization project. Read-only Cloud Billing inspection reports `billingEnabled: false` for that project, so requests use the Gemini Developer API Free Tier rather than the application project’s Google Cloud trial credit. The credential is stored in the application project’s Secret Manager and injected into Cloud Run as a numerically pinned server-side secret; it is never exposed to browser code or committed to the repository. Exact project identifiers are intentionally omitted from public documentation.

At last verification, a Gemini 3.5 Flash response identified the project as Free Tier and reported a quota limit of `5` for the relevant request metric. Quotas and reset windows can change, so the live API response and Google AI Studio are authoritative. A `429` is a capacity/quota signal, not permission to add billing: wait for the indicated retry window, use deterministic local/mock tests, and never select `Set up billing`, prepay, or auto-reload for this project.

## Provider boundary

All provider-specific code belongs behind a gateway such as:

~~~ts
interface GeminiGateway {
  createInterviewBlueprint(input: BlueprintInput): Promise<InterviewBlueprint>;
  analyzeBoard(input: BoardAnalysisInput): Promise<ReasoningState>;
  generateFinalReport(input: FinalReportInput): Promise<FinalReport>;
  createLiveEphemeralToken(input: LiveTokenInput): Promise<LiveTokenResult>;
}
~~~

`RealGeminiGateway` and `MockGeminiGateway` implement this boundary. Explicit real mode never changes provider mode or silently replaces board analysis with mock output. Its two narrow deterministic behaviors are operation-specific and auditable: the fixed demo blueprint preserves scarce Free Tier quota, and a transient-only final-report fallback carries an explicit limitation. Mock mode remains visibly labeled.

## Current Interactions API request shape

The May 2026 API revision removed the former top-level `response_mime_type` pattern. Current structured output is a polymorphic `response_format` with `type: "text"`, `mime_type: "application/json"`, and a nested JSON `schema`. The response convenience field is `interaction.output_text`.

The JavaScript SDK’s Interactions fields currently follow the API’s snake_case names:

~~~ts
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: serverOnlyGeminiApiKey });

const interaction = await client.interactions.create({
  model: process.env.GEMINI_REASONING_MODEL ?? "gemini-3.5-flash",
  system_instruction: ANALYZE_BOARD_SYSTEM_INSTRUCTION,
  input: [
    {
      type: "text",
      text: JSON.stringify({
        problemStatement,
        stage,
        recentTranscript,
        olderSessionSummary,
        normalizedScene,
        semanticDiff,
        previousReasoningState,
        rubric,
        activeConstraints,
        analysisVersion,
      }),
    },
    {
      type: "image",
      data: boardPngBase64,
      mime_type: "image/png",
    },
  ],
  response_format: {
    type: "text",
    mime_type: "application/json",
    schema: reasoningStateJsonSchema,
  },
  generation_config: {
    thinking_level: "medium",
    max_output_tokens: 4096,
  },
  store: false,
});

const candidate = JSON.parse(interaction.output_text);
const reasoningState = reasoningStateSchema.parse(candidate);
~~~

The schema passed to Gemini and the Zod schema used after parsing must describe the same contract. Zod validation remains authoritative even when Gemini reports schema compliance.

The board image is resized to a bounded maximum dimension while preserving label readability. The normalized scene is authoritative for IDs; the image contributes spatial context. Selected images are sent inline because each analysis uses one bounded temporary image. Revisit Files API uploads only if size or reuse makes inline data unsuitable.

### Required analysis context

Every request carries:

- exact problem statement and hidden system-design rubric;
- current deterministic stage and active constraints;
- recent finalized transcript segments with stable IDs/timestamps;
- a compact older-session summary;
- current normalized scene and semantic diff;
- previous validated reasoning state;
- bounded current board image; and
- monotonically increasing analysis version.

The prompt requires the model to distinguish observation from inference, avoid invented components, track revisions over time, and return one highest-value probe.

## Validation, evidence, and confidence

1. Parse `output_text` as JSON.
2. Validate the result through strict Zod schemas.
3. If validation fails, make one repair request containing the validation errors and original invalid result.
4. If repair fails, return a recoverable analysis error and keep the interview/board usable.
5. Compare every returned board ID with the current normalized scene.
6. Remove or reject unknown IDs. If the contradiction loses its evidence, suppress the assertion.
7. Confirm the response analysis version is still current before persistence or focus.
8. Apply the application confidence threshold. Below the threshold, ask a neutral clarification rather than state an error as fact.
9. Persist only the validated/sanitized state and evidence event. Never place raw model output in UI state.

One safe retry is allowed for bounded transient failures such as HTTP 408, 429, or 5xx. Authentication, permission, invalid-request, and validation failures are not blindly retried. Logs record request ID, model, duration, attempt, and sanitized status—not prompts, transcript text, board images, raw output, or credentials.

### Deterministic resilience matrix

| Operation in deployed real mode | Provider behavior | Failure behavior |
| --- | --- | --- |
| Fixed `demo` / `global-rate-limiter` blueprint | Deterministic application-owned blueprint; no Gemini request | Schema validation still applies |
| Board-and-transcript analysis | Real Gemini 3.5 Flash request | No deterministic fallback; return a recoverable analysis error |
| Final report | Real Gemini 3.5 Flash request | Only after a transient/retryable failure, assemble a schema-valid report from validated session evidence and show the explicit provider-unavailable limitation |
| Live interviewer | Disabled in the deployed service | Working text fallback remains available |

This does not turn real mode into mock mode. The flagship contradiction and exact focus IDs must still come from Gemini for a real-provider claim.

## Flagship analyzer behavior

For the rate-limiter fixture, the model receives:

- a transcript segment equivalent to “quotas must remain globally consistent”;
- a normalized scene with stable IDs for a US API, US Redis, EU API, and EU Redis;
- regional API-to-store connections;
- no cross-region synchronization path; and
- the board image.

A usable result must cite known relevant store IDs, explain that the drawn stores lack shared coordination relative to the spoken requirement, and recommend one concise probe. After a synchronization component/connector appears, later analysis should record a revision rather than repeat the original contradiction unchanged.

The deterministic mock guarantees this flow for tests. The server-only Free Tier authorization is available for an opt-in real Gemini smoke fixture, but a successful model response must be observed before claiming real-provider completion.

## Live ephemeral tokens

Browser-to-Live connections use a backend-minted ephemeral token. The permanent credential never enters browser code.

Current server-side provisioning shape:

~~~ts
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: serverOnlyGeminiApiKey });
const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

const token = await client.authTokens.create({
  config: {
    uses: 1,
    expireTime,
    newSessionExpireTime,
    liveConnectConstraints: {
      model: "gemini-3.1-flash-live-preview",
      config: {
        systemInstruction: LIVE_SYSTEM_INSTRUCTION,
        responseModalities: ["AUDIO"],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: {},
        tools: LIVE_TOOL_DECLARATIONS,
      },
    },
    httpOptions: {
      apiVersion: "v1alpha",
    },
  },
});

return token.name;
~~~

The backend route first verifies anonymous session ownership, origin, session state, feature flag, and rate limit. It returns only the ephemeral token name and expiry metadata. It never returns or logs the permanent credential.

Ephemeral tokens work only with Live and `v1alpha`. A one-use token may still resume the same session; resumption does not consume a new use.

## Current Live JavaScript shape

The snippets below record the verified official SDK shape used by the browser adapter and the bounded real-provider check.

Live SDK configuration uses camelCase, unlike the current Interactions request:

~~~ts
import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: ephemeralToken });

const session = await ai.live.connect({
  model: "gemini-3.1-flash-live-preview",
  callbacks: {
    onopen: handleOpen,
    onmessage: handleServerMessage,
    onerror: handleError,
    onclose: handleClose,
  },
  config: {
    systemInstruction: LIVE_SYSTEM_INSTRUCTION,
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: { handle: priorResumptionHandle },
    tools: LIVE_TOOL_DECLARATIONS,
  },
});
~~~

Send a complete typed turn and real-time microphone data with:

~~~ts
session.sendClientContent({ turns: fallbackText, turnComplete: true });

session.sendRealtimeInput({
  audio: {
    data: pcm16Base64,
    mimeType: "audio/pcm;rate=16000",
  },
});
~~~

Typed turns and microphone chunks share the same Live session. `sendClientContent` gives typed turns explicit ordering and completion, while `sendRealtimeInput` keeps audio responsive through server-side voice activity detection.

Input audio is raw little-endian 16-bit PCM, natively 16 kHz. Output audio is 24 kHz. Send input in approximately 20–100 ms chunks for responsive interaction.

### Receiving messages

A single Gemini 3.1 Live event may contain multiple content parts. The reducer must process all of them, plus independent message fields:

- audio in every `serverContent.modelTurn.parts[*].inlineData`;
- `serverContent.inputTranscription`;
- `serverContent.outputTranscription`;
- `serverContent.interrupted` and playback clearing;
- `serverContent.turnComplete` / `generationComplete`;
- `toolCall.functionCalls`;
- `toolCallCancellation`;
- `sessionResumptionUpdate.newHandle`; and
- `goAway.timeLeft`.

Do not use an `else if` chain that discards co-occurring parts.

## Live tools

The Live session declares only these application actions:

- `request_board_analysis`
- `focus_board_elements`
- `record_interview_signal`
- `advance_interview_stage`
- `inject_constraint`
- `request_candidate_reflection`
- `finish_interview`

Gemini 3.1 Flash Live supports synchronous function calls only. The application validates arguments with Zod, executes the call, and responds manually:

~~~ts
session.sendToolResponse({
  functionResponses: [
    {
      id: functionCall.id,
      name: functionCall.name,
      response: {
        result: validatedApplicationResult,
      },
    },
  ],
});
~~~

The model waits for the response before it may reference the resulting board evidence. Tool responses must preserve matching IDs/names, and application operations must be idempotent where a reconnect could redeliver work.

## Session resilience and fallback

- Enable context-window compression.
- Keep the latest resumable handle; official documentation says it remains valid for two hours after termination.
- Respond to `goAway.timeLeft` by preparing a resumed connection.
- Use bounded exponential backoff and visible disconnected/reconnecting/recovered states.
- Keep the board and session state outside the WebSocket lifecycle.
- Immediately clear queued output audio on interruption.
- If Live or the microphone fails, retain the independent Gemini 3.5 Flash board-analysis endpoint and working text fallback.
- Treat denied, revoked, unavailable, and transient microphone states as distinct UI states.

Without compression, official documentation limits audio-only sessions to 15 minutes; an individual connection is around 10 minutes. The browser handles audio interruption and records resumption/GoAway events, while automatic reconnect execution remains pending.

## Test policy

- Automated unit/integration/E2E tests use the deterministic reasoning gateway plus isolated Live dispatcher/reducer tests. No mock Live transport is wired.
- A real Gemini reasoning smoke test is opt-in and uses explicitly supplied server-side credentials; never print or copy secret values into test output.
- A real Live smoke test is opt-in because the API/model are Preview and may incur cost.
- SDK or model changes require rereading current official docs and rerunning the real fixtures.
- No real API or Live success is claimed until recorded in `docs/QA_REPORT.md`.

## Official references

- [Gemini Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [May 2026 Interactions breaking changes](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026)
- [Interactions API reference](https://ai.google.dev/api/interactions-api)
- [Gemini 3.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash)
- [Gemini 3.5 Flash changes](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5)
- [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Image understanding with Interactions](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Live API tool use](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Live API ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
- [Live API session management](https://ai.google.dev/gemini-api/docs/live-api/session-management)
- [Gemini model lifecycle and deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
