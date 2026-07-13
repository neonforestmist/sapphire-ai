# SapphireAI architecture

Last updated: 2026-07-13

## Design principles

- The whiteboard is the primary interaction surface.
- Gemini interprets observable multimodal evidence and recommends a probe.
- Deterministic application code owns identity, permissions, validation, state transitions, persistence, rendering, and deletion.
- The Live interviewer is conversational, not the authoritative scoring engine.
- Stable board IDs and evidence references survive every snapshot, report card, and replay step.
- External providers sit behind interfaces with real and deterministic mock implementations.
- A Live or cloud failure must not destroy the local board or block text-based board analysis.

## System architecture

The diagram is the target P0-P2 architecture. The verified local runtime currently uses text input, Excalidraw, direct analysis APIs, the deterministic gateway, and memory repositories. Live token/tool/state foundations and cloud adapters exist, but browser Live audio and authenticated cloud services are not active.

~~~mermaid
flowchart LR
    Candidate["Candidate"]
    Mic["Microphone audio"]
    Text["Text fallback"]
    Board["Excalidraw board"]
    Live["Gemini Live interviewer<br/>3.1 Flash Live Preview"]
    UI["Next.js interview room"]
    API["Next.js server routes"]
    Orchestrator["Interview orchestrator<br/>application-owned state"]
    Analyzer["Gemini reasoning gateway<br/>3.5 Flash Interactions API"]
    Mock["Deterministic Gemini mock"]
    Memory["Memory repositories"]
    Firestore["Firestore"]
    Storage["Private Cloud Storage"]

    Candidate --> Mic
    Candidate --> Text
    Candidate --> Board
    Mic --> Live
    Text --> UI
    Board --> UI
    Live <-->|"ephemeral token + synchronous tools"| UI
    UI <-->|"owned JSON APIs"| API
    API --> Orchestrator
    Orchestrator --> Analyzer
    Orchestrator --> Mock
    Orchestrator --> Memory
    Orchestrator --> Firestore
    Orchestrator --> Storage
    Analyzer -->|"validated ReasoningState"| Orchestrator
    Mock -->|"validated deterministic state"| Orchestrator
    Orchestrator -->|"exact focus IDs + probe"| UI
~~~

### Runtime boundaries

| Boundary | Responsibilities |
| --- | --- |
| Browser | Current: board interaction, local continuity, focus overlays, text fallback. Target: microphone capture, Live audio playback, and captions |
| Server routes | Ownership checks, Zod validation, size/rate/concurrency limits, sanitized errors, ephemeral-token minting |
| Interview orchestrator | Legal stage transitions, event ordering, stale-version rejection, confidence policy, persistence, report assembly |
| Gemini reasoning gateway | Provider request/response translation, timeout/retry/repair policy, model-output parsing |
| Repository interfaces | Session, event, report, snapshot metadata, and binary snapshot operations |
| Cloud services | Container execution, durable structured data, private snapshot objects, secret delivery, structured logs |

## Live tool-call flow

This sequence is the P1 target. Strict tools, dispatch, and recovery state are implemented; the browser connection/audio steps are not.

~~~mermaid
sequenceDiagram
    participant C as Candidate
    participant B as Browser Live client
    participant L as Gemini Live
    participant A as Interview API
    participant O as Orchestrator
    participant R as Reasoning gateway

    C->>B: Speech or text
    B->>L: sendRealtimeInput
    L-->>B: Input/output transcript and audio parts
    L-->>B: request_board_analysis call with ID
    B->>A: Owned analyze-board request
    A->>O: Validate session, version, and state
    O->>R: Image + scene + diff + transcript + rubric
    R-->>O: Zod-validated ReasoningState
    O-->>A: Persisted result and exact known IDs
    A-->>B: Sanitized analysis result
    B->>L: sendToolResponse with matching call ID
    L-->>B: Concise evidence-grounded probe
    B-->>C: Audio/caption plus board focus overlay
~~~

Tool execution is synchronous for `gemini-3.1-flash-live-preview`. The browser never invents a successful tool result. Every call is validated and dispatched to application-owned logic; every response echoes the original call ID and function name.

## Board-analysis pipeline

~~~mermaid
flowchart TD
    Change["Excalidraw onChange"]
    Normalize["Normalize stable scene elements"]
    Diff["Compute semantic diff"]
    Meaningful{"Meaningful change<br/>or explicit request?"}
    Debounce["Debounce and assign analysisVersion"]
    Export["Export bounded readable PNG"]
    Context["Assemble scene, diff, transcript,<br/>previous state, stage, rubric, constraints"]
    Request["GeminiGateway.analyzeBoard"]
    Validate["Parse JSON and validate with Zod"]
    Repair{"Valid?"}
    Retry["One schema-repair request"]
    IDs["Reject unknown board IDs"]
    Confidence["Apply confidence policy"]
    Stale{"Latest version?"}
    Persist["Append evidence events and reasoning"]
    Focus["Return exact focus IDs and probe"]
    Recover["Recoverable error; interview continues"]

    Change --> Normalize --> Diff --> Meaningful
    Meaningful -->|"no"| Change
    Meaningful -->|"yes"| Debounce --> Export --> Context --> Request --> Validate --> Repair
    Repair -->|"yes"| IDs
    Repair -->|"no"| Retry --> Validate
    Retry -->|"still invalid"| Recover
    IDs --> Confidence --> Stale
    Stale -->|"no"| Change
    Stale -->|"yes"| Persist --> Focus
~~~

The normalized scene is authoritative for IDs and relationships. The image adds spatial and visual context but does not authorize IDs absent from the scene. If invalid IDs remove the evidence supporting a contradiction, the application suppresses the assertion and asks a neutral clarification.

## Interview state machine

~~~mermaid
stateDiagram-v2
    [*] --> SETUP
    SETUP --> BRIEFING: consent + session created
    BRIEFING --> REQUIREMENT_CLARIFICATION
    REQUIREMENT_CLARIFICATION --> INITIAL_DECOMPOSITION
    INITIAL_DECOMPOSITION --> SOLUTION_CONSTRUCTION
    SOLUTION_CONSTRUCTION --> CONSTRAINT_INJECTION
    CONSTRAINT_INJECTION --> TRADEOFF_CHALLENGE
    TRADEOFF_CHALLENGE --> REFLECTION
    REFLECTION --> GENERATING_REPORT
    GENERATING_REPORT --> COMPLETE
    COMPLETE --> [*]
~~~

Only the application state machine can commit a transition. Gemini can recommend `advance_stage`, but the orchestrator validates the source state, destination, ownership, idempotency, and evidence before appending `stage.changed`.

## Data storage

~~~mermaid
flowchart TB
    API["Server API and orchestrator"]
    SessionRepo["Session repository"]
    EventRepo["Append-only event repository"]
    ReportRepo["Report repository"]
    SnapshotRepo["Snapshot repository"]
    Memory["In-process memory<br/>local and deterministic tests"]
    FSessions["Firestore sessions"]
    FEvents["Firestore ordered events"]
    FReports["Firestore reports"]
    GCS["Private Cloud Storage<br/>selected PNG snapshots"]

    API --> SessionRepo
    API --> EventRepo
    API --> ReportRepo
    API --> SnapshotRepo
    SessionRepo --> Memory
    EventRepo --> Memory
    ReportRepo --> Memory
    SnapshotRepo --> Memory
    SessionRepo --> FSessions
    EventRepo --> FEvents
    ReportRepo --> FReports
    SnapshotRepo --> GCS
    FEvents -. "stable refs" .-> GCS
    FReports -. "evidence refs" .-> FEvents
~~~

### Logical records

- **Session:** anonymous session ID, ownership digest, consent state, role pack, stage, current analysis version, timestamps, and deletion state.
- **Transcript segment:** stable ID, input/output speaker, finalized text, start/end timestamps, and source.
- **Board snapshot:** stable snapshot ID, normalized scene, semantic diff, analysis version, timestamp, and optional private object reference.
- **Reasoning state:** validated summary, observations, contradictions, competency signals, one recommended probe, confidence, and exact evidence references.
- **Event:** monotonic sequence number, event type, timestamp, actor, stable references, and minimal validated payload.
- **Report:** evidence-backed explanations and replay steps referencing events, transcript segments, elements, and selected snapshots.

No raw microphone audio is retained by default. Board images are selected snapshots, not continuous video. Object paths are opaque and never public; retrieval passes through an ownership-authorized route.

## Flagship evidence sequence

~~~mermaid
sequenceDiagram
    participant T as Transcript
    participant W as Whiteboard
    participant A as Analyzer
    participant U as UI
    participant E as Event store

    T->>E: Finalize global-consistency claim
    W->>E: Save isolated US/EU Redis scene and diff
    E->>A: Claim + image + scene + diff
    A-->>E: Contradiction with known Redis IDs
    E-->>U: Exact focus IDs and coordination probe
    W->>E: Add synchronization component/connectors
    E->>A: Revision diff + prior reasoning
    A-->>E: Recognized revision evidence
    E-->>U: Clear/update focus and acknowledge revision
    E-->>U: Evidence-linked report and replay
~~~

## Security and failure containment

- Permanent Gemini authorization remains server-side. If the Live path is completed and enabled, the browser receives only a constrained ephemeral token.
- Anonymous ownership capabilities are stored in HttpOnly, SameSite cookies and compared using a server-side digest.
- API inputs, provider outputs, Live tools, stored events, and reports are all validated with Zod.
- Per-session concurrency and analysis versions prevent racing responses from overwriting newer state.
- Logs contain request IDs, event types, model names, durations, and status—not raw audio, secrets, full transcripts, board images, or raw provider output.
- Memory/mock mode is visibly labeled. Explicit real mode never silently downgrades to mock.
- Live disconnects affect conversation presence only; local board state and the independent reasoning endpoint remain usable.
- Firestore and Cloud Storage are adapters, so local implementation and tests do not wait for cloud credentials.
