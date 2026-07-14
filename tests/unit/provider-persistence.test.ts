import { describe, expect, it } from "vitest";

import {
  finalReportSchema,
  interviewBlueprintSchema,
  interviewSessionSchema,
  sessionCreatedEventSchema,
  type BoardSnapshotRecord,
} from "@/lib/interview/schemas";
import {
  InMemorySessionRepository,
  InMemorySnapshotRepository,
} from "@/lib/persistence/memory";

const session = interviewSessionSchema.parse({
  id: "session-1",
  scenarioId: "rate-limiter",
  mode: "demo",
  stage: "SETUP",
  status: "active",
  createdAt: 1,
  updatedAt: 1,
  latestAnalysisVersion: 0,
});

describe("in-memory session persistence", () => {
  it("enforces append-only event sequence and deletes the full session timeline", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(session);
    const event = sessionCreatedEventSchema.parse({
      id: "event-1",
      sessionId: session.id,
      sequence: 1,
      occurredAt: 1,
      type: "session.created",
      payload: { scenarioId: session.scenarioId, mode: "demo", initialStage: "SETUP" },
    });
    await expect(repository.appendEvent(session.id, event)).resolves.toEqual(event);
    await expect(
      repository.appendEvent(session.id, { ...event, id: "event-2", sequence: 3 }),
    ).rejects.toMatchObject({ code: "EVENT_SEQUENCE_CONFLICT" });
    expect(await repository.listEvents(session.id)).toEqual([event]);
    const blueprint = interviewBlueprintSchema.parse({
      id: "blueprint-1",
      scenarioId: session.scenarioId,
      interviewType: "system-design",
      roleTitle: "Senior Software Engineer",
      seniority: "Senior",
      problemStatement: "Design a rate limiter.",
      initialKnownRequirements: ["Serve multiple regions."],
      withheldClarifications: [],
      hiddenRubric: ["Global consistency"],
      constraints: [],
      competencyDefinitions: [
        { competency: "technical_correctness", description: "Technical correctness" },
      ],
      stageGuidance: [{ stage: "BRIEFING", guidance: "Introduce the prompt." }],
      reportTemplateSections: ["Technical correctness"],
      estimatedDurationMinutes: 6,
    });
    await expect(repository.saveBlueprint(session.id, blueprint)).resolves.toEqual(blueprint);
    expect(await repository.getBlueprint(session.id)).toEqual(blueprint);

    const evidence = {
      transcriptSegmentIds: [],
      boardElementIds: [],
      snapshotId: null,
    };
    const timeline = {
      id: "timeline-1",
      eventId: event.id,
      kind: "board_change" as const,
      label: "Session created",
      occurredAt: 1,
      evidence,
    };
    const judgment = {
      id: "judgment-1",
      title: "Observed evidence",
      explanation: "The report is backed by the stored event timeline.",
      occurredAt: 1,
      evidence,
      confidence: 0.9,
    };
    const section = { summary: "Evidence summary", judgments: [judgment] };
    const report = finalReportSchema.parse({
      id: "report-1",
      sessionId: session.id,
      generatedAt: 2,
      problemFraming: section,
      requirementDiscovery: section,
      decomposition: section,
      technicalCorrectness: section,
      tradeoffReasoning: section,
      adaptabilityUnderChallenge: section,
      communication: section,
      strongestObservedMoment: judgment,
      mostImportantMissedIssue: judgment,
      keyDecisionTimeline: [timeline],
      boardEvolutionTimeline: [timeline],
      contradictionProbeRevision: {
        initialDecision: null,
        detectedInconsistency: null,
        interviewerProbe: null,
        candidateRevision: null,
      },
      practiceExercises: [
        { id: "practice-1", title: "One", instruction: "Practice one.", rationale: "Reason one." },
        { id: "practice-2", title: "Two", instruction: "Practice two.", rationale: "Reason two." },
        { id: "practice-3", title: "Three", instruction: "Practice three.", rationale: "Reason three." },
      ],
      limitations: ["Evidence only."],
      confidence: 0.9,
    });
    await expect(repository.saveReport(session.id, report)).resolves.toEqual(report);
    expect(await repository.getReport(session.id)).toEqual(report);
    expect(await repository.delete(session.id)).toBe(true);
    expect(await repository.get(session.id)).toBeNull();
    expect(await repository.listEvents(session.id)).toEqual([]);
    expect(await repository.getBlueprint(session.id)).toBeNull();
    expect(await repository.getReport(session.id)).toBeNull();
  });
});

describe("in-memory snapshot persistence", () => {
  it("stores private image bytes by copy and removes all session artifacts", async () => {
    const repository = new InMemorySnapshotRepository();
    const record: BoardSnapshotRecord = {
      id: "snapshot-1",
      sessionId: session.id,
      createdAt: 2,
      scene: { elements: [], capturedAt: 2 },
      imageObjectPath: null,
      imageMimeType: null,
      analysisVersion: 1,
    };
    const source = Uint8Array.from([1, 2, 3]);
    const saved = await repository.save(record, { data: source, mimeType: "image/png" });
    source[0] = 9;

    expect(saved.imageObjectPath).toMatch(/^memory:/);
    expect((await repository.getImage(session.id, record.id))?.data).toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    expect(await repository.deleteForSession(session.id)).toBe(1);
    expect(await repository.getRecord(session.id, record.id)).toBeNull();
  });
});
