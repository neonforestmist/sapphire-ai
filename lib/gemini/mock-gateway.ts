import {
  finalReportSchema,
  interviewBlueprintSchema,
  reasoningStateSchema,
  type BlueprintInput,
  type BoardAnalysisInput,
  type EvidenceRef,
  type FinalReport,
  type FinalReportInput,
  type InterviewBlueprint,
  type LiveTokenInput,
  type LiveTokenResult,
  type ReasoningState,
  type ReportTimelineItem,
  type SessionEvent,
} from "@/lib/interview/schemas";

import type { GeminiGateway } from "./gateway";

const GLOBAL_CLAIM = /global(?:ly)?\s+(?:consistent|shared)|single\s+(?:global\s+)?quota|(?:one|single)\s+shared\s+(?:usage\s+)?limit/i;
const STORE_LABEL = /redis|quota\s*store|rate.?limit\s*store|counter/i;
const COORDINATION_LABEL = /synchron|coordinat|consensus|shared\s*state|global\s*store/i;

const EXPERIENCE_LABELS = {
  intern: "Intern",
  "early-career": "Early career",
  "mid-level": "Mid-level",
  senior: "Senior",
} as const;

const INTERVIEW_VARIANTS = {
  "system-design": {
    problemStatement: "Give an app one shared usage limit for each user.",
    initialKnownRequirements: [
      "Serve users from US and EU regions.",
      "Allow 10 requests per user each minute.",
    ],
    hiddenRubric: [
      "Clarify scope and traffic.",
      "Define rate-limit semantics.",
      "Address global versus regional consistency.",
      "Discuss latency and availability trade-offs.",
      "Choose and justify an algorithm.",
      "Place state and define synchronization.",
      "Cover failure modes, hot keys, abuse, observability, and rollout.",
    ],
  },
  "technical-explanation": {
    problemStatement: "Explain how you would evaluate an AI assistant before an internship launch.",
    initialKnownRequirements: [
      "The assistant answers beginner programming questions.",
      "The team needs evidence that answers are useful and safe.",
    ],
    hiddenRubric: [
      "Define what a good answer means.",
      "Separate offline evaluation from user feedback.",
      "Discuss representative test cases and failure cases.",
      "Explain trade-offs in clear language.",
      "Propose a practical launch decision.",
    ],
  },
  "case-study": {
    problemStatement: "Help a support team reduce response time without lowering answer quality.",
    initialKnownRequirements: [
      "The team handles product questions from small-business customers.",
      "Leadership wants a measurable improvement within one quarter.",
    ],
    hiddenRubric: [
      "Clarify the customer and current workflow.",
      "Choose useful success metrics.",
      "Prioritize a small number of testable changes.",
      "Identify risks and counter-metrics.",
      "Communicate a practical recommendation.",
    ],
  },
  behavioral: {
    problemStatement: "Tell me about a time you learned an unfamiliar tool quickly.",
    initialKnownRequirements: [
      "Use one specific example.",
      "Explain your actions, result, and what you learned.",
    ],
    hiddenRubric: [
      "Give enough context to understand the situation.",
      "Describe personal actions rather than only team actions.",
      "Use concrete evidence for the result.",
      "Reflect on what changed afterward.",
      "Communicate clearly and concisely.",
    ],
  },
} as const;

function emptyEvidence(snapshotId: string | null): EvidenceRef {
  return { transcriptSegmentIds: [], boardElementIds: [], snapshotId };
}

function connectedGraph(input: BoardAnalysisInput): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    graph.set(from, graph.get(from) ?? new Set());
    graph.set(to, graph.get(to) ?? new Set());
    graph.get(from)?.add(to);
    graph.get(to)?.add(from);
  };
  for (const element of input.scene.elements.filter((candidate) => !candidate.deleted)) {
    graph.set(element.id, graph.get(element.id) ?? new Set());
    for (const connected of [...element.connectedFromIds, ...element.connectedToIds]) {
      add(element.id, connected);
    }
    if (element.connectedFromIds.length > 0 && element.connectedToIds.length > 0) {
      for (const from of element.connectedFromIds) {
        for (const to of element.connectedToIds) add(from, to);
      }
    }
  }
  return graph;
}

function hasPath(graph: Map<string, Set<string>>, start: string, goal: string): boolean {
  const pending = [start];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    if (current === goal) return true;
    seen.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  return false;
}

export class MockGeminiGateway implements GeminiGateway {
  readonly mode = "mock" as const;

  constructor(private readonly now: () => number = () => Date.now()) {}

  async createInterviewBlueprint(input: BlueprintInput): Promise<InterviewBlueprint> {
    const variant = INTERVIEW_VARIANTS[input.interviewType];
    return interviewBlueprintSchema.parse({
      id: `blueprint-${input.scenarioId}`.slice(0, 128),
      scenarioId: input.scenarioId,
      interviewType: input.interviewType,
      roleTitle: input.targetRole,
      seniority: EXPERIENCE_LABELS[input.experienceLevel],
      problemStatement: variant.problemStatement,
      initialKnownRequirements: variant.initialKnownRequirements,
      withheldClarifications: input.interviewType === "system-design" ? [
        {
          id: "clarification-consistency",
          questionPattern: "Is the usage limit shared across both regions?",
          answer: "Yes. A user gets 10 requests total, not 10 in each region.",
        },
      ] : [],
      hiddenRubric: variant.hiddenRubric,
      constraints: input.interviewType === "system-design" ? [
        {
          id: "region-partition",
          text: "The US-to-EU network link can be unavailable for several minutes.",
          targetStage: "CONSTRAINT_INJECTION",
        },
      ] : [],
      competencyDefinitions: [
        ["problem_framing", "Clarifies users, scope, and success conditions."],
        ["requirement_discovery", "Surfaces functional and non-functional constraints."],
        ["decomposition", "Builds a coherent component and data-flow model."],
        ["technical_correctness", "Uses technically sound mechanisms and invariants."],
        ["tradeoff_reasoning", "Explains consistency, latency, and availability choices."],
        ["adaptability", "Revises the design in response to evidence and constraints."],
        ["communication", "Connects spoken claims to the evolving board."],
      ].map(([competency, description]) => ({ competency, description })),
      stageGuidance: [
        ["BRIEFING", "Introduce the scenario concisely."],
        ["REQUIREMENT_CLARIFICATION", "Let the candidate clarify requirements."],
        ["INITIAL_DECOMPOSITION", "Observe the first component decomposition."],
        ["SOLUTION_CONSTRUCTION", "Compare claims with the evolving architecture."],
        ["CONSTRAINT_INJECTION", "Inject the configured network-partition constraint."],
        ["TRADEOFF_CHALLENGE", "Probe one high-value trade-off."],
        ["REFLECTION", "Ask for a concise reflection."],
        ["GENERATING_REPORT", "Generate an evidence-backed report."],
      ].map(([stage, guidance]) => ({ stage, guidance })),
      reportTemplateSections: [
        "Problem framing",
        "Requirement discovery",
        "Decomposition",
        "Technical correctness",
        "Trade-off reasoning",
        "Adaptability",
        "Communication",
      ],
      estimatedDurationMinutes: input.mode === "demo" ? 6 : 45,
    });
  }

  async analyzeBoard(input: BoardAnalysisInput): Promise<ReasoningState> {
    const visible = input.scene.elements.filter((element) => !element.deleted);
    // Excalidraw emits a bound text child alongside each labeled container.
    // Ground architectural evidence in the container shape, never the duplicate label node.
    const stores = visible.filter(
      (element) => element.type !== "text" && STORE_LABEL.test(element.text ?? ""),
    );
    const coordination = visible.filter(
      (element) =>
        element.type !== "text" && COORDINATION_LABEL.test(element.text ?? ""),
    );
    const globalClaim = [...input.recentTranscript]
      .reverse()
      .find((segment) => segment.speaker === "candidate" && GLOBAL_CLAIM.test(segment.text));
    const graph = connectedGraph(input);
    const storesDirectlyConnected =
      stores.length >= 2 &&
      stores.slice(1).every((store) => graph.get(stores[0]!.id)?.has(store.id));
    const storesShareCoordination = coordination.some((component) =>
      stores.length >= 2 && stores.every((store) => hasPath(graph, component.id, store.id)),
    );
    const storesCoordinated = storesDirectlyConnected || storesShareCoordination;
    const priorMismatch = input.previousReasoningState?.contradictions.some(
      (contradiction) => contradiction.id === "contradiction-global-consistency",
    ) ?? false;
    const evidence: EvidenceRef = {
      transcriptSegmentIds: globalClaim ? [globalClaim.id] : [],
      boardElementIds: stores.map((store) => store.id),
      snapshotId: input.snapshotId,
    };

    if (globalClaim && stores.length >= 2 && !storesCoordinated) {
      return reasoningStateSchema.parse({
        boardSummary: "The board contains separate regional quota stores without a visible synchronization path.",
        candidateApproachSummary: "The candidate routes each regional API service to a regional quota store.",
        observations: [
          {
            id: "observation-global-requirement",
            category: "requirement",
            statement: "The candidate requires one shared usage limit for each user.",
            evidence,
            confidence: 0.99,
          },
        ],
        contradictions: [
          {
            id: "contradiction-global-consistency",
            description: "The shared usage rule is not represented by the disconnected regional counters.",
            spokenClaim: globalClaim.text,
            boardInterpretation: "The regional counters have no shared-state or synchronization path.",
            whyItMatters: "A user could receive the full allowance once in each region.",
            evidence,
            confidence: 0.98,
          },
        ],
        unresolvedQuestions: ["How do the two counters share each user's usage?"],
        updatedCompetencySignals: [
          {
            id: "signal-requirement-consistency",
            competency: "technical_correctness",
            sentiment: "growth_area",
            statement: "The current board does not yet enforce the stated global quota invariant.",
            evidence,
            confidence: 0.96,
          },
        ],
        recommendedProbe: {
          action: "ask",
          question: "You want one shared limit, but these regional counters do not exchange updates. What stops a user from using the full limit in both regions?",
          reason: "This is the clearest mismatch between the stated rule and the current diagram.",
          focusElementIds: stores.map((store) => store.id),
          urgency: "next_pause",
          confidence: 0.98,
        },
        analysisConfidence: 0.98,
      });
    }

    if (priorMismatch && storesCoordinated && coordination.length > 0) {
      const revisionEvidence: EvidenceRef = {
        transcriptSegmentIds: globalClaim ? [globalClaim.id] : [],
        boardElementIds: [...stores, ...coordination].map((element) => element.id),
        snapshotId: input.snapshotId,
      };
      return reasoningStateSchema.parse({
        boardSummary: "The regional quota stores now connect through a coordination component.",
        candidateApproachSummary: "The candidate revised the design so both regions share user usage.",
        observations: [
          {
            id: "observation-coordination-revision",
            category: "revision",
            statement: "The candidate added a synchronization path between regional quota stores.",
            evidence: revisionEvidence,
            confidence: 0.97,
          },
          {
            id: "observation-adaptability",
            category: "positive_signal",
            statement: "The revision directly addresses the earlier consistency mismatch.",
            evidence: revisionEvidence,
            confidence: 0.96,
          },
        ],
        contradictions: [],
        unresolvedQuestions: ["What consistency and availability trade-off does this coordination mechanism make during a partition?"],
        updatedCompetencySignals: [
          {
            id: "signal-adaptability-revision",
            competency: "adaptability",
            sentiment: "strength",
            statement: "The candidate revised the board in response to an evidence-grounded probe.",
            evidence: revisionEvidence,
            confidence: 0.97,
          },
        ],
        recommendedProbe: {
          action: "ask",
          question: "How does this coordination path behave if the regions lose connectivity?",
          reason: "The consistency mismatch is resolved; the next useful step is its availability trade-off.",
          focusElementIds: coordination.map((element) => element.id),
          urgency: "next_pause",
          confidence: 0.93,
        },
        analysisConfidence: 0.97,
      });
    }

    return reasoningStateSchema.parse({
      boardSummary: visible.length > 0 ? "The board is evolving, but there is not enough grounded evidence for a contradiction." : "The board is currently empty.",
      candidateApproachSummary: "No high-confidence architectural mismatch is currently established.",
      observations: [],
      contradictions: [],
      unresolvedQuestions: [],
      updatedCompetencySignals: [],
      recommendedProbe: {
        action: "wait",
        question: null,
        reason: "Wait for another meaningful claim or board change.",
        focusElementIds: [],
        urgency: "wait",
        confidence: 0.9,
      },
      analysisConfidence: 0.9,
    });
  }

  async generateFinalReport(input: FinalReportInput): Promise<FinalReport> {
    const firstEvent = input.events[0]!;
    const timeline = input.events.map((event, index) => this.timelineItem(event, index));
    const baseEvidence = timeline.at(-1)?.evidence ?? emptyEvidence(input.snapshots.at(-1)?.id ?? null);
    const occurredAt = timeline.at(-1)?.occurredAt ?? firstEvent.occurredAt;
    const judgment = (id: string, title: string, explanation: string) => ({
      id,
      title,
      explanation,
      occurredAt,
      evidence: baseEvidence,
      confidence: 0.9,
    });
    const section = (id: string, summary: string) => ({
      summary,
      judgments: [judgment(`judgment-${id}`, summary, `Evidence from the interview supports this ${id.replaceAll("-", " ")} assessment.`)],
    });
    const initialDecision = timeline.find((item) => item.kind === "decision") ?? null;
    const detectedInconsistency = timeline.find((item) => item.kind === "contradiction") ?? null;
    const interviewerProbe = timeline.find((item) => item.kind === "probe") ?? null;
    const candidateRevision = timeline.find((item) => item.kind === "revision") ?? null;

    return finalReportSchema.parse({
      id: `report-${input.session.id}`.slice(0, 128),
      sessionId: input.session.id,
      generatedAt: this.now(),
      problemFraming: section("problem-framing", "The candidate established the central quota requirement."),
      requirementDiscovery: section("requirement-discovery", "The interview surfaced global consistency as a key requirement."),
      decomposition: section("decomposition", "The board separated the app and its usage counter by region."),
      technicalCorrectness: section("technical-correctness", detectedInconsistency ? "An initial state-coordination gap was identified." : "No unsupported technical judgment was added."),
      tradeoffReasoning: section("tradeoff-reasoning", "The evidence supports continued practice on consistency and availability trade-offs."),
      adaptabilityUnderChallenge: section("adaptability", candidateRevision ? "The candidate revised the design after the probe." : "No evidence-backed revision was recorded."),
      communication: section("communication", "Spoken requirements were compared with visible architecture evidence."),
      strongestObservedMoment: judgment("strongest-moment", "Strongest observed moment", candidateRevision ? "The candidate made an evidence-linked board revision." : "The candidate stated a concrete system invariant."),
      mostImportantMissedIssue: judgment("missed-issue", "Most important missed issue", detectedInconsistency ? "The initial design did not show how the US and EU counters shared one user limit." : "More evidence is needed to identify a specific missed issue."),
      keyDecisionTimeline: timeline,
      boardEvolutionTimeline: timeline.filter((item) => ["board_change", "contradiction", "probe", "revision"].includes(item.kind)).length > 0
        ? timeline.filter((item) => ["board_change", "contradiction", "probe", "revision"].includes(item.kind))
        : [timeline[0]!],
      contradictionProbeRevision: {
        initialDecision,
        detectedInconsistency,
        interviewerProbe,
        candidateRevision,
      },
      practiceExercises: [
        { id: "practice-partition", title: "Partition policy", instruction: "State the exact quota behavior during a regional partition.", rationale: "This makes the consistency/availability choice explicit." },
        { id: "practice-hot-key", title: "Hot-key load", instruction: "Trace a single abusive user through the design at peak load.", rationale: "This tests contention and abuse controls." },
        { id: "practice-rollout", title: "Safe rollout", instruction: "Define metrics and a staged rollout for quota enforcement changes.", rationale: "This connects correctness to production operation." },
      ],
      limitations: ["This report evaluates only supplied transcript and whiteboard evidence.", "Mock mode is deterministic and is not evidence of a real Gemini API call."],
      confidence: 0.9,
    });
  }

  async createLiveEphemeralToken(input: LiveTokenInput): Promise<LiveTokenResult> {
    const now = this.now();
    return {
      token: `mock-live-token-${input.sessionId}`,
      expiresAt: now + 30 * 60 * 1_000,
      newSessionExpiresAt: now + 60 * 1_000,
      model: "mock-live",
    };
  }

  private timelineItem(event: SessionEvent, index: number): ReportTimelineItem {
    let kind: ReportTimelineItem["kind"] = "board_change";
    let label: string = event.type;
    let evidence = emptyEvidence(null);
    switch (event.type) {
      case "transcript.input.finalized":
      case "transcript.output.finalized":
        kind = "decision";
        label = event.payload.segment.text.slice(0, 1_000);
        evidence = { transcriptSegmentIds: [event.payload.segment.id], boardElementIds: [], snapshotId: null };
        break;
      case "board.snapshot.created":
        evidence = { transcriptSegmentIds: [], boardElementIds: [], snapshotId: event.payload.snapshot.id };
        break;
      case "board.analysis.completed": {
        const contradiction = event.payload.reasoningState.contradictions[0];
        kind = contradiction ? "contradiction" : "board_change";
        label = contradiction?.description ?? event.payload.reasoningState.boardSummary;
        evidence = contradiction?.evidence ?? emptyEvidence(event.payload.snapshotId);
        break;
      }
      case "board.elements.focused":
        kind = "probe";
        label = event.payload.message;
        evidence = { transcriptSegmentIds: [], boardElementIds: event.payload.elementIds, snapshotId: event.payload.snapshotId };
        break;
      case "candidate.revision.detected":
        kind = "revision";
        label = "Candidate revision detected";
        evidence = event.payload.evidence;
        break;
      case "constraint.injected":
        kind = "constraint";
        label = event.payload.text;
        break;
      case "interview.completed":
        kind = "reflection";
        label = event.payload.reason;
        break;
      default:
        break;
    }
    return {
      id: `timeline-${index + 1}`,
      eventId: event.id,
      kind,
      label: label || event.type,
      occurredAt: event.occurredAt,
      evidence,
    };
  }
}
