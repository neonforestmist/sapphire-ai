import type { BoardAnalysisInput, ReasoningState, TranscriptSegment } from "../interview/schemas";
import { normalizeExcalidrawScene } from "./normalize";
import { createInitialBoardDiff, createSemanticBoardDiff } from "./semantic-diff";

export const RATE_LIMITER_IDS = {
  session: "session-rate-limiter-demo",
  globalClaimTranscript: "transcript-global-consistency",
  initialSnapshot: "snapshot-rate-limiter-initial",
  revisedSnapshot: "snapshot-rate-limiter-revised",
  usApi: "us-api",
  usRedis: "us-redis",
  euApi: "eu-api",
  euRedis: "eu-redis",
  usRegionalArrow: "us-api-to-redis",
  euRegionalArrow: "eu-api-to-redis",
  coordinator: "global-quota-coordinator",
  usSyncArrow: "us-redis-to-coordinator",
  euSyncArrow: "eu-redis-to-coordinator",
} as const;

export const RATE_LIMITER_PROBLEM_STATEMENT =
  "Give an app one shared usage limit for each user.";

export const RATE_LIMITER_GLOBAL_CLAIM =
  "Each user gets one shared usage limit across the US and EU.";

const INITIAL_RAW_ELEMENTS: readonly unknown[] = [
  {
    id: RATE_LIMITER_IDS.usApi,
    type: "rectangle",
    text: "US API",
    x: 80,
    y: 120,
    width: 160,
    height: 80,
    angle: 0,
    version: 1,
  },
  {
    id: RATE_LIMITER_IDS.usRedis,
    type: "rectangle",
    text: "US counter (Redis)",
    x: 340,
    y: 120,
    width: 160,
    height: 80,
    angle: 0,
    version: 1,
  },
  {
    id: RATE_LIMITER_IDS.euApi,
    type: "rectangle",
    text: "EU API",
    x: 80,
    y: 360,
    width: 160,
    height: 80,
    angle: 0,
    version: 1,
  },
  {
    id: RATE_LIMITER_IDS.euRedis,
    type: "rectangle",
    text: "EU counter (Redis)",
    x: 340,
    y: 360,
    width: 160,
    height: 80,
    angle: 0,
    version: 1,
  },
  {
    id: RATE_LIMITER_IDS.usRegionalArrow,
    type: "arrow",
    x: 240,
    y: 160,
    width: 100,
    height: 0,
    angle: 0,
    startBinding: { elementId: RATE_LIMITER_IDS.usApi },
    endBinding: { elementId: RATE_LIMITER_IDS.usRedis },
    version: 1,
  },
  {
    id: RATE_LIMITER_IDS.euRegionalArrow,
    type: "arrow",
    x: 240,
    y: 400,
    width: 100,
    height: 0,
    angle: 0,
    startBinding: { elementId: RATE_LIMITER_IDS.euApi },
    endBinding: { elementId: RATE_LIMITER_IDS.euRedis },
    version: 1,
  },
];

const REVISION_RAW_ELEMENTS: readonly unknown[] = [
  ...INITIAL_RAW_ELEMENTS,
  {
    id: RATE_LIMITER_IDS.coordinator,
    type: "rectangle",
    text: "Global quota coordinator",
    x: 650,
    y: 240,
    width: 230,
    height: 100,
    angle: 0,
    version: 1,
  },
  {
    id: RATE_LIMITER_IDS.usSyncArrow,
    type: "arrow",
    x: 500,
    y: 160,
    width: 150,
    height: 110,
    angle: 0,
    startBinding: { elementId: RATE_LIMITER_IDS.usRedis },
    endBinding: { elementId: RATE_LIMITER_IDS.coordinator },
    version: 1,
  },
  {
    id: RATE_LIMITER_IDS.euSyncArrow,
    type: "arrow",
    x: 500,
    y: 400,
    width: 150,
    height: 110,
    angle: 0,
    startBinding: { elementId: RATE_LIMITER_IDS.euRedis },
    endBinding: { elementId: RATE_LIMITER_IDS.coordinator },
    version: 1,
  },
];

export const RATE_LIMITER_INITIAL_SCENE = normalizeExcalidrawScene(INITIAL_RAW_ELEMENTS, 1_000);
export const RATE_LIMITER_REVISED_SCENE = normalizeExcalidrawScene(REVISION_RAW_ELEMENTS, 2_000);
export const RATE_LIMITER_INITIAL_DIFF = createInitialBoardDiff(RATE_LIMITER_INITIAL_SCENE);
export const RATE_LIMITER_REVISION_DIFF = createSemanticBoardDiff(
  RATE_LIMITER_INITIAL_SCENE,
  RATE_LIMITER_REVISED_SCENE,
);

export const RATE_LIMITER_GLOBAL_TRANSCRIPT: TranscriptSegment = {
  id: RATE_LIMITER_IDS.globalClaimTranscript,
  sessionId: RATE_LIMITER_IDS.session,
  speaker: "candidate",
  source: "text",
  text: RATE_LIMITER_GLOBAL_CLAIM,
  startedAt: 800,
  endedAt: 900,
  finalized: true,
};

export const createRateLimiterAnalysisInput = (
  revised: boolean,
  previousReasoningState: ReasoningState | null = null,
): BoardAnalysisInput => ({
  requestId: revised ? "request-rate-limiter-revised" : "request-rate-limiter-initial",
  sessionId: RATE_LIMITER_IDS.session,
  analysisVersion: revised ? 2 : 1,
  snapshotId: revised ? RATE_LIMITER_IDS.revisedSnapshot : RATE_LIMITER_IDS.initialSnapshot,
  problemStatement: RATE_LIMITER_PROBLEM_STATEMENT,
  boardImage: null,
  scene: revised ? RATE_LIMITER_REVISED_SCENE : RATE_LIMITER_INITIAL_SCENE,
  diff: revised ? RATE_LIMITER_REVISION_DIFF : RATE_LIMITER_INITIAL_DIFF,
  previousReasoningState,
  currentStage: "SOLUTION_CONSTRUCTION",
  recentTranscript: [RATE_LIMITER_GLOBAL_TRANSCRIPT],
  olderSessionSummary: "The candidate is limiting an app's usage across two regions.",
  hiddenRubric: [
    "Clarify scope and traffic.",
    "Define global versus regional consistency semantics.",
    "Explain state placement and synchronization.",
    "Discuss latency and availability trade-offs.",
    "Cover failure modes, hot keys, abuse, observability, and rollout.",
  ],
  activeConstraints: [],
});
