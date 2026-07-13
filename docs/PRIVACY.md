# SapphireAI privacy and safety

Last updated: 2026-07-13

## Product purpose

SapphireAI is an interview-practice and learning prototype. It evaluates observable interview artifacts only:

- finalized spoken or typed technical statements;
- whiteboard shapes, labels, arrows, grouping, deletion, and revision;
- explicitly stated assumptions and trade-offs; and
- responses to interviewer constraints and follow-up questions.

It does not claim to read thoughts or private chain of thought. It must not infer facial expression, attractiveness, eye contact, accent quality, voice pitch, emotion, personality, mental state, protected traits, or culture fit. It is not an autonomous hiring system and does not make employment decisions.

## Status notice

The deterministic text/board flow, consent, anonymous ownership, evidence storage, report/replay, and deletion are verified locally and through the private Cloud Run deployment. That deployed journey used Firestore and the private snapshot bucket, then verified that session documents and objects were removed. The current build performs no microphone capture. Browser Live audio remains target behavior; consult `docs/QA_REPORT.md` for the exact verification boundary.

## Consent

Before microphone capture or transcript persistence, the setup flow must explain:

- what observable data is processed;
- that Gemini may process board images, structured scenes, and transcript text;
- that raw microphone audio is not stored by SapphireAI by default;
- which data may be retained for report/replay;
- how to use text fallback; and
- how to delete the session.

Microphone permission is optional. Denial, revocation, or unavailability must leave a functional text path. Consent is recorded as a timestamped event associated with an anonymous session.

## Data processed

| Data | Purpose | Default handling |
| --- | --- | --- |
| Anonymous session ID and ownership capability | Isolate one demo user’s session | Capability stored in a secure HttpOnly cookie; only a digest is stored server-side |
| Finalized input/output transcripts | Compare stated reasoning with the board; captions/replay | Stored only after consent |
| Normalized board scene | Stable element IDs, relationships, diffs, replay | Stored at meaningful checkpoints |
| Selected board PNG snapshots | Multimodal analysis and visual replay | Bounded, selected snapshots only; not continuous video |
| Semantic board diffs | Detect additions, removals, text and connection changes | Stored with stable references |
| Validated Gemini reasoning | Probe, observations, evidence, confidence | Strict schema; raw provider output excluded from UI state |
| Evidence events | Ordered report/replay timeline | Append-only, minimal validated payloads |
| Final report | Practice feedback and exercises | Contains evidence references and stated confidence |
| Operational metadata | Reliability and abuse controls | Request IDs, model, duration, event/status; no raw private content |

## Data not stored by default

- raw microphone audio;
- continuous whiteboard video or every canvas frame;
- private chain of thought;
- facial video, biometrics, emotion, or personality inference;
- permanent Gemini credentials or Google Cloud credentials;
- unvalidated raw model output;
- plaintext anonymous ownership capabilities; and
- unrelated browser, account, resume, payment, or employment data.

If the future Gemini Live connection is enabled, that service necessarily processes streaming audio during an active authorized connection. SapphireAI's application storage is designed not to retain that raw stream.

## Local and mock mode

Credential-free local/mock mode uses in-process memory repositories. Data disappears when the process restarts, except for any browser-local working state deliberately used to survive a transient connection failure.

Mock mode is visibly labeled. It must not silently represent deterministic fixture output as real Gemini analysis.

## Cloud mode

The private deployment has exercised these authenticated cloud controls:

- Firestore stores structured sessions, finalized transcripts, normalized scenes, events, reasoning, and reports.
- Cloud Storage contains selected snapshot objects in a private bucket with uniform bucket-level access and public-access prevention.
- Snapshot access is proxied or signed only after session ownership authorization.
- Secret Manager supplies the permanent Gemini authorization and session-signing secret to the Cloud Run revision.
- Cloud Run emits sanitized structured logs through stdout/stderr.

The runtime service account receives only the documented Firestore data, bucket-object, and named-secret permissions. No service-account key is committed or downloaded for the application.

## Gemini data flow

Board analysis sends the minimum useful context to Gemini:

- a bounded board image;
- normalized scene and semantic diff;
- recent finalized transcript window and compact older summary;
- prior validated reasoning;
- problem statement, stage, rubric, and constraints; and
- analysis version.

If the Live transport is completed and enabled, the browser will connect with a one-use, short-lived, constrained ephemeral token minted by the backend. The permanent credential remains server-side. The current browser does not open that connection.

Users of a deployed instance should also review the applicable Google Gemini API and Google Cloud data-processing terms for the approved account/project. This project document is not a substitute for those terms or legal advice.

## Retention

The required prototype behavior is:

- retain only what is needed for the active session, evidence-backed report, and replay;
- avoid continuous or redundant snapshots;
- support full user-initiated deletion; and
- define an operator retention policy before any public deployment.

No fixed automatic retention duration is claimed until it is implemented, configured, and verified. A public deployment must publish its actual retention window and scheduled cleanup behavior before collecting non-demo participant data.

## Deletion

The user-facing delete action must:

1. verify anonymous session ownership;
2. mark the deletion operation idempotently;
3. delete the selected snapshot object prefix;
4. delete report, reasoning, transcript, snapshot metadata, and event records;
5. delete the session record;
6. expire the ownership cookie/local session state; and
7. make subsequent session/report/replay access return not found.

Deletion failures must be visible and retryable. The application must not report success while known artifacts remain. Cloud-provider backup or recovery retention, if applicable, must be documented before public use.

## Security controls

- All external inputs and provider outputs are Zod-validated.
- API routes enforce ownership, origin, input size, content type, per-session concurrency, and rate limits.
- Snapshot uploads accept only approved image types and bounded sizes.
- Model output is rendered as text, never trusted HTML.
- Unknown board IDs returned by Gemini are rejected.
- Confidence policy prevents weak inference from being stated as fact.
- Permanent credentials remain server-side and are never prefixed with `NEXT_PUBLIC_`.
- Secrets, raw audio, transcripts, board images, and raw model payloads are excluded from logs.
- Security headers and same-origin APIs reduce injection and cross-site risks.
- Session IDs and object paths are high-entropy/opaque.

## User controls

The current interface provides explicit consent, text fallback, visible mock/real mode, manual board analysis, accessible focused-element reveal, report limitations/confidence, replay, and delete-session action.

Microphone start/stop and permission-state controls remain required before browser Live audio can be described as implemented.

## Known limitations

- This is a hackathon prototype, not a clinical, accessibility-assessment, or hiring-decision system.
- Gemini can be wrong. Evidence links and confidence communicate the basis of feedback but do not make it infallible.
- Preview Live behavior and model availability can change.
- Anonymous capability-based ownership is appropriate for a demo but does not provide account recovery.
- Automatic time-based retention and external processor behavior still require a documented production policy before public use.
- Cloud deletion and privacy controls were verified for the deterministic deployed journey. Real Gemini authorization is configured, but the final analysis smoke ended in transient provider-capacity errors and is not evidence of a successful model result.

## Incident handling

If private content or a secret appears in source, logs, screenshots, or a client bundle:

1. stop the affected service/test;
2. restrict access to the artifact;
3. rotate/revoke the credential if applicable;
4. remove the artifact from distribution and logs where possible;
5. determine the affected session scope;
6. document the event and corrective action; and
7. rerun secret scanning and the relevant privacy/security tests before redeployment.

Do not include private participant data in bug reports or other public project assets.
