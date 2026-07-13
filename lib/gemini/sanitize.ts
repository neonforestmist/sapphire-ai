import {
  reasoningStateSchema,
  type BoardAnalysisInput,
  type EvidenceRef,
  type ReasoningState,
} from "@/lib/interview/schemas";

const NEUTRAL_CLARIFICATION =
  "Could you clarify how the current board implements the requirement you just described?";

export function sanitizeReasoningState(
  state: ReasoningState,
  input: BoardAnalysisInput,
  contradictionThreshold: number,
): ReasoningState {
  const knownElementIds = new Set(input.scene.elements.map((element) => element.id));
  const knownTranscriptIds = new Set(input.recentTranscript.map((segment) => segment.id));

  const sanitizeEvidence = (evidence: EvidenceRef): EvidenceRef => ({
    transcriptSegmentIds: evidence.transcriptSegmentIds.filter((id) => knownTranscriptIds.has(id)),
    boardElementIds: evidence.boardElementIds.filter((id) => knownElementIds.has(id)),
    snapshotId: evidence.snapshotId === input.snapshotId ? evidence.snapshotId : input.snapshotId,
  });

  const observations = state.observations.map((observation) => ({
    ...observation,
    evidence: sanitizeEvidence(observation.evidence),
  }));
  const updatedCompetencySignals = state.updatedCompetencySignals.map((signal) => ({
    ...signal,
    evidence: sanitizeEvidence(signal.evidence),
  }));
  const sanitizedContradictions = state.contradictions.map((contradiction) => ({
    ...contradiction,
    evidence: sanitizeEvidence(contradiction.evidence),
  }));
  const hadLowConfidenceContradiction = sanitizedContradictions.some(
    (contradiction) => contradiction.confidence < contradictionThreshold,
  );
  const hadUngroundedContradiction = sanitizedContradictions.some(
    (contradiction) => contradiction.evidence.boardElementIds.length === 0,
  );
  const contradictions = sanitizedContradictions.filter(
    (contradiction) =>
      contradiction.confidence >= contradictionThreshold &&
      state.analysisConfidence >= contradictionThreshold &&
      contradiction.evidence.boardElementIds.length > 0,
  );
  const focusElementIds = state.recommendedProbe.focusElementIds.filter((id) =>
    knownElementIds.has(id),
  );
  const downgradeProbe =
    contradictions.length === 0 &&
    state.recommendedProbe.action === "ask" &&
    (hadLowConfidenceContradiction ||
      hadUngroundedContradiction ||
      state.analysisConfidence < contradictionThreshold);

  return reasoningStateSchema.parse({
    ...state,
    observations,
    contradictions,
    updatedCompetencySignals,
    recommendedProbe: downgradeProbe
      ? {
          action: "ask",
          question: NEUTRAL_CLARIFICATION,
          reason: "The available evidence is not strong enough to assert a contradiction.",
          focusElementIds,
          urgency: "next_pause",
          confidence: Math.min(state.recommendedProbe.confidence, state.analysisConfidence),
        }
      : { ...state.recommendedProbe, focusElementIds },
  });
}
