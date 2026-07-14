import {
  boardAnalysisInputSchema,
  reasoningStateSchema,
  type BoardAnalysisInput,
  type ReasoningState,
} from "./schemas";
import type { NormalizedBoardElement } from "../whiteboard/schemas";

const GLOBAL_CONSISTENCY_PATTERN =
  /\b(global(?:ly)?\s+consistent|consistent\s+(?:across|between|in)\s+(?:all\s+)?regions?|global\s+(?:quota|consistency|limit)|(?:one|single)\s+shared\s+(?:usage\s+)?limit)\b/i;
const STORE_PATTERN = /\b(redis|cache|store|database|db|counter)\b/i;
const US_PATTERN = /\b(us|usa|united states|north america)\b/i;
const EU_PATTERN = /\b(eu|europe|european)\b/i;
const COORDINATION_PATTERN = /\b(sync|synchronization|coordinat|global quota|shared state|consensus)\w*/i;

const activeElements = (input: BoardAnalysisInput): NormalizedBoardElement[] =>
  input.scene.elements.filter((element) => !element.deleted);

const findRegionalStore = (
  elements: readonly NormalizedBoardElement[],
  regionPattern: RegExp,
): NormalizedBoardElement | undefined =>
  elements.find(
    (element) =>
      element.text !== null && STORE_PATTERN.test(element.text) && regionPattern.test(element.text),
  );

const createUndirectedGraph = (
  elements: readonly NormalizedBoardElement[],
): Map<string, Set<string>> => {
  const graph = new Map(elements.map((element) => [element.id, new Set<string>()]));
  const connect = (left: string, right: string): void => {
    if (left === right || !graph.has(left) || !graph.has(right)) {
      return;
    }
    graph.get(left)?.add(right);
    graph.get(right)?.add(left);
  };

  for (const element of elements) {
    if (element.connectedFromIds.length > 0 && element.connectedToIds.length > 0) {
      for (const from of element.connectedFromIds) {
        for (const to of element.connectedToIds) {
          connect(from, to);
        }
      }
      continue;
    }
    element.connectedFromIds.forEach((from) => connect(from, element.id));
    element.connectedToIds.forEach((to) => connect(element.id, to));
  }

  return graph;
};

const isReachable = (
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  to: string,
): boolean => {
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    if (current === to) {
      return true;
    }
    visited.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  return false;
};

/** Deterministic mock used by unit tests and the credential-free demo path. */
export const createDeterministicMockReasoning = (
  inputValue: BoardAnalysisInput,
): ReasoningState => {
  const input = boardAnalysisInputSchema.parse(inputValue);
  const elements = activeElements(input);
  const transcriptClaim = input.recentTranscript.find(
    (segment) => segment.speaker === "candidate" && GLOBAL_CONSISTENCY_PATTERN.test(segment.text),
  );
  const usStore = findRegionalStore(elements, US_PATTERN);
  const euStore = findRegionalStore(elements, EU_PATTERN);
  const coordinatorCandidates = elements.filter(
    (element) => element.text !== null && COORDINATION_PATTERN.test(element.text),
  );
  const graph = createUndirectedGraph(elements);
  const sharedCoordinator = coordinatorCandidates.find(
    (candidate) =>
      usStore !== undefined &&
      euStore !== undefined &&
      isReachable(graph, usStore.id, candidate.id) &&
      isReachable(graph, euStore.id, candidate.id),
  );
  const storeIds = [usStore?.id, euStore?.id].filter((id): id is string => id !== undefined);
  const snapshotId = input.snapshotId;
  const hadConsistencyContradiction =
    input.previousReasoningState?.contradictions.some((contradiction) =>
      /global|region|shared state|consisten/i.test(
        `${contradiction.description} ${contradiction.whyItMatters}`,
      ),
    ) ?? false;

  if (
    transcriptClaim !== undefined &&
    usStore !== undefined &&
    euStore !== undefined &&
    sharedCoordinator === undefined
  ) {
    return reasoningStateSchema.parse({
      boardSummary: "The US and EU app services each use an isolated regional counter.",
      candidateApproachSummary:
        "The candidate wants one shared user limit but currently keeps each region's count separate.",
      observations: [
        {
          id: "observation-global-requirement",
          category: "requirement",
          statement: "The candidate explicitly requires one shared usage limit.",
          evidence: {
            transcriptSegmentIds: [transcriptClaim.id],
            boardElementIds: [],
            snapshotId: null,
          },
          confidence: 0.99,
        },
        {
          id: "observation-regional-stores",
          category: "decision",
          statement: "Usage is counted in separate US and EU Redis counters.",
          evidence: {
            transcriptSegmentIds: [],
            boardElementIds: storeIds,
            snapshotId,
          },
          confidence: 0.98,
        },
      ],
      contradictions: [
        {
          id: "contradiction-global-vs-regional-state",
          description:
            "The shared usage limit conflicts with isolated regional counters.",
          spokenClaim: transcriptClaim.text,
          boardInterpretation:
            "The US and EU counters have no visible shared-state or synchronization path.",
          whyItMatters:
            "A user could receive the full allowance once in the US and again in the EU.",
          evidence: {
            transcriptSegmentIds: [transcriptClaim.id],
            boardElementIds: storeIds,
            snapshotId,
          },
          confidence: 0.97,
        },
      ],
      unresolvedQuestions: ["How will the two counters share each user's usage?"],
      updatedCompetencySignals: [
        {
          id: "signal-consistency-requirement",
          competency: "requirement_discovery",
          sentiment: "strength",
          statement: "The candidate stated one clear usage rule.",
          evidence: {
            transcriptSegmentIds: [transcriptClaim.id],
            boardElementIds: [],
            snapshotId: null,
          },
          confidence: 0.95,
        },
      ],
      recommendedProbe: {
        action: "ask",
        question:
          "You want one shared limit, but these regional counters do not exchange updates. What stops a user from using the full limit in both regions?",
        reason: "Check whether the candidate notices that the two counters need a coordination path.",
        focusElementIds: storeIds,
        urgency: "next_pause",
        confidence: 0.97,
      },
      analysisConfidence: 0.98,
    });
  }

  if (
    transcriptClaim !== undefined &&
    usStore !== undefined &&
    euStore !== undefined &&
    sharedCoordinator !== undefined
  ) {
    const evidenceIds = [usStore.id, euStore.id, sharedCoordinator.id];
    return reasoningStateSchema.parse({
      boardSummary:
        "Both regional counters now connect to a shared coordination component.",
      candidateApproachSummary:
        "The candidate revised the design so both regions share user usage.",
      observations: [
        {
          id: "observation-coordination-revision",
          category: hadConsistencyContradiction ? "revision" : "decision",
          statement:
            "A shared coordination path now connects both regional counters.",
          evidence: {
            transcriptSegmentIds: [transcriptClaim.id],
            boardElementIds: evidenceIds,
            snapshotId,
          },
          confidence: 0.96,
        },
        {
          id: "observation-adaptability",
          category: "positive_signal",
          statement: "The candidate addressed the consistency gap in the evolving design.",
          evidence: {
            transcriptSegmentIds: [transcriptClaim.id],
            boardElementIds: evidenceIds,
            snapshotId,
          },
          confidence: 0.94,
        },
      ],
      contradictions: [],
      unresolvedQuestions: [
        "What latency, availability, and failure-mode trade-offs does the coordinator introduce?",
      ],
      updatedCompetencySignals: [
        {
          id: "signal-consistency-revision",
          competency: "adaptability",
          sentiment: "strength",
          statement: "The candidate corrected a design inconsistency after a focused probe.",
          evidence: {
            transcriptSegmentIds: [transcriptClaim.id],
            boardElementIds: evidenceIds,
            snapshotId,
          },
          confidence: 0.94,
        },
      ],
      recommendedProbe: {
        action: "wait",
        question: null,
        reason: "The consistency mismatch has been addressed; allow the candidate to continue.",
        focusElementIds: [],
        urgency: "wait",
        confidence: 0.94,
      },
      analysisConfidence: 0.96,
    });
  }

  return reasoningStateSchema.parse({
    boardSummary:
      elements.length === 0
        ? "The board does not yet contain a system design."
        : "The board contains an early usage-limit design without enough evidence for a contradiction.",
    candidateApproachSummary:
      "The candidate's consistency requirement or regional state topology is not yet explicit.",
    observations: [],
    contradictions: [],
    unresolvedQuestions: ["What consistency semantics should the quota provide across regions?"],
    updatedCompetencySignals: [],
    recommendedProbe: {
      action: "ask",
      question: "What consistency semantics should the quota provide across regions?",
      reason: "Clarify the requirement before evaluating the topology.",
      focusElementIds: storeIds,
      urgency: "next_pause",
      confidence: 0.66,
    },
    analysisConfidence: 0.68,
  });
};
