import {
  reasoningStateSchema,
  type EvidenceRef,
  type ReasoningState,
} from "./schemas";
import {
  normalizedBoardSceneSchema,
  stableBoardElementIdSchema,
  type NormalizedBoardScene,
} from "../whiteboard/schemas";

export class UnknownBoardElementIdError extends Error {
  public readonly unknownElementIds: readonly string[];

  public constructor(unknownElementIds: readonly string[]) {
    super(`Reasoning output referenced unknown board element IDs: ${unknownElementIds.join(", ")}`);
    this.name = "UnknownBoardElementIdError";
    this.unknownElementIds = unknownElementIds;
  }
}

export type ReasoningSanitizationResult = {
  state: ReasoningState;
  removedElementIds: string[];
  droppedContradictionIds: string[];
  probeSuppressed: boolean;
};

export const DEFAULT_CONTRADICTION_CONFIDENCE_THRESHOLD = 0.72;

export type ReasoningConfidenceResult = {
  state: ReasoningState;
  suppressedContradictionIds: string[];
  probeDowngraded: boolean;
};

const unique = (values: Iterable<string>): string[] => [...new Set(values)];

const sanitizeEvidence = (
  evidence: EvidenceRef,
  knownElementIds: ReadonlySet<string>,
  removed: Set<string>,
): EvidenceRef => ({
  ...evidence,
  boardElementIds: evidence.boardElementIds.filter((id) => {
    if (knownElementIds.has(id)) {
      return true;
    }
    removed.add(id);
    return false;
  }),
});

export const sanitizeBoardElementIds = (
  candidateIds: readonly unknown[],
  sceneInput: NormalizedBoardScene,
): { validIds: string[]; unknownIds: string[] } => {
  const scene = normalizedBoardSceneSchema.parse(sceneInput);
  const knownIds = new Set(
    scene.elements.filter((element) => !element.deleted).map((element) => element.id),
  );
  const validIds: string[] = [];
  const unknownIds: string[] = [];

  for (const candidateId of candidateIds) {
    const parsed = stableBoardElementIdSchema.safeParse(candidateId);
    if (parsed.success && knownIds.has(parsed.data)) {
      if (!validIds.includes(parsed.data)) {
        validIds.push(parsed.data);
      }
      continue;
    }

    if (typeof candidateId === "string" && !unknownIds.includes(candidateId)) {
      unknownIds.push(candidateId);
    }
  }

  return { validIds, unknownIds };
};

/**
 * Remove unverifiable IDs from non-assertive evidence and suppress any
 * contradiction/probe whose board evidence contains an unknown or deleted ID.
 */
export const sanitizeReasoningStateElementIds = (
  stateInput: ReasoningState,
  sceneInput: NormalizedBoardScene,
  mode: "filter" | "reject" = "filter",
): ReasoningSanitizationResult => {
  const state = reasoningStateSchema.parse(stateInput);
  const scene = normalizedBoardSceneSchema.parse(sceneInput);
  const knownElementIds = new Set(
    scene.elements.filter((element) => !element.deleted).map((element) => element.id),
  );
  const removed = new Set<string>();
  const droppedContradictionIds: string[] = [];

  const observations = state.observations.map((observation) => ({
    ...observation,
    evidence: sanitizeEvidence(observation.evidence, knownElementIds, removed),
  }));
  const updatedCompetencySignals = state.updatedCompetencySignals.map((signal) => ({
    ...signal,
    evidence: sanitizeEvidence(signal.evidence, knownElementIds, removed),
  }));
  const contradictions = state.contradictions.flatMap((contradiction) => {
    const contradictionUnknownIds = contradiction.evidence.boardElementIds.filter(
      (id) => !knownElementIds.has(id),
    );
    if (contradictionUnknownIds.length > 0) {
      contradictionUnknownIds.forEach((id) => removed.add(id));
      droppedContradictionIds.push(contradiction.id);
      return [];
    }

    return [contradiction];
  });

  const sanitizedFocus = state.recommendedProbe.focusElementIds.filter((id) => {
    if (knownElementIds.has(id)) {
      return true;
    }
    removed.add(id);
    return false;
  });
  const probeSuppressed =
    sanitizedFocus.length !== state.recommendedProbe.focusElementIds.length ||
    droppedContradictionIds.length > 0;

  const removedElementIds = unique(removed).sort((left, right) => left.localeCompare(right));
  if (mode === "reject" && removedElementIds.length > 0) {
    throw new UnknownBoardElementIdError(removedElementIds);
  }

  const sanitizedState = reasoningStateSchema.parse({
    ...state,
    observations,
    contradictions,
    updatedCompetencySignals,
    recommendedProbe: probeSuppressed
      ? {
          action: "wait",
          question: null,
          reason: "Board evidence could not be matched to the current scene.",
          focusElementIds: [],
          urgency: "wait",
          confidence: Math.min(state.recommendedProbe.confidence, 0.49),
        }
      : { ...state.recommendedProbe, focusElementIds: sanitizedFocus },
  });

  return {
    state: sanitizedState,
    removedElementIds,
    droppedContradictionIds,
    probeSuppressed,
  };
};

/** Convert uncertain contradiction assertions into a neutral clarification. */
export const enforceReasoningConfidenceThreshold = (
  stateInput: ReasoningState,
  threshold = DEFAULT_CONTRADICTION_CONFIDENCE_THRESHOLD,
): ReasoningConfidenceResult => {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("threshold must be between 0 and 1");
  }

  const state = reasoningStateSchema.parse(stateInput);
  const contradictions = state.contradictions.filter(
    (contradiction) => contradiction.confidence >= threshold,
  );
  const suppressedContradictionIds = state.contradictions
    .filter((contradiction) => contradiction.confidence < threshold)
    .map((contradiction) => contradiction.id);
  const probeDowngraded =
    state.recommendedProbe.action === "ask" &&
    (state.recommendedProbe.confidence < threshold ||
      state.analysisConfidence < threshold ||
      (state.contradictions.length > 0 && contradictions.length === 0));

  return {
    state: reasoningStateSchema.parse({
      ...state,
      contradictions,
      recommendedProbe: probeDowngraded
        ? {
            action: "ask",
            question:
              "Can you walk me through how the current board satisfies the stated requirements across regions?",
            reason: "The available evidence supports clarification, not a contradiction assertion.",
            focusElementIds: state.recommendedProbe.focusElementIds,
            urgency: "next_pause",
            confidence: state.recommendedProbe.confidence,
          }
        : state.recommendedProbe,
    }),
    suppressedContradictionIds,
    probeDowngraded,
  };
};
