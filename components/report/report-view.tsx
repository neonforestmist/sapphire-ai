"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import { displayText } from "@/components/display-text";
import type {
  BoardSnapshotRecord,
  FinalReport,
  InterviewSession,
  ReportEvidenceItem,
  ReportTimelineItem,
  SessionEvent,
} from "@/lib/interview/schemas";
import type { NormalizedBoardElement } from "@/lib/whiteboard/schemas";

import styles from "./report-view.module.css";

type ApiEnvelope<T> = { data?: T; error?: { message: string } };
type ReportPayload = {
  report: FinalReport;
  session: InterviewSession;
  events: SessionEvent[];
  snapshots: BoardSnapshotRecord[];
};

async function readApi<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "The report could not be loaded.");
  }
  return body.data;
}

function shortTime(timestamp: number, start: number): string {
  const totalSeconds = Math.max(0, Math.round((timestamp - start) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function BoardReplay({
  snapshot,
  highlightedIds,
}: {
  snapshot: BoardSnapshotRecord | null;
  highlightedIds: string[];
}) {
  const active = (snapshot?.scene.elements ?? []).filter((element) => !element.deleted);
  const shapes = active.filter((element) =>
    ["rectangle", "ellipse", "diamond"].includes(element.type),
  );
  const lines = active.filter((element) => ["arrow", "line"].includes(element.type));
  const bounds = (() => {
    if (active.length === 0) return { x: 0, y: 0, width: 1_000, height: 560 };
    const minX = Math.min(...active.map((element) => element.x)) - 60;
    const minY = Math.min(...active.map((element) => element.y)) - 60;
    const maxX = Math.max(...active.map((element) => element.x + element.width)) + 60;
    const maxY = Math.max(...active.map((element) => element.y + element.height)) + 60;
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  })();

  if (!snapshot) {
    return <div className={styles.emptyReplay}>No board snapshot was persisted for this moment.</div>;
  }

  const isHighlighted = (element: NormalizedBoardElement) => highlightedIds.includes(element.id);

  return (
    <svg
      className={styles.replaySvg}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      role="img"
      aria-label="Whiteboard snapshot replay"
    >
      <defs>
        <pattern id="replay-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#1c2b46" />
        </pattern>
        <filter id="focus-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <marker id="arrow-head" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#668bdc" />
        </marker>
      </defs>
      <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="#070d19" />
      <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="url(#replay-grid)" />
      {lines.map((element) => (
        <line
          key={element.id}
          x1={element.x}
          y1={element.y}
          x2={element.x + element.width}
          y2={element.y + element.height}
          stroke={isHighlighted(element) ? "#63ddff" : "#668bdc"}
          strokeWidth={isHighlighted(element) ? 5 : 3}
          markerEnd={element.type === "arrow" ? "url(#arrow-head)" : undefined}
          filter={isHighlighted(element) ? "url(#focus-glow)" : undefined}
        />
      ))}
      {shapes.map((element) => {
        const focused = isHighlighted(element);
        const labelLines = displayText(element.text ?? element.id).split("\n");
        const labelX = element.x + element.width / 2;
        const labelY =
          element.y + element.height / 2 - ((labelLines.length - 1) * 12);
        const shapeProps = {
          fill: focused ? "#10374a" : "#10203e",
          stroke: focused ? "#63ddff" : "#6489db",
          strokeWidth: focused ? 5 : 3,
        };
        return (
          <g
            key={element.id}
            data-element-id={element.id}
            filter={focused ? "url(#focus-glow)" : undefined}
          >
            {element.type === "ellipse" ? (
              <ellipse
                cx={labelX}
                cy={element.y + element.height / 2}
                rx={element.width / 2}
                ry={element.height / 2}
                {...shapeProps}
              />
            ) : element.type === "diamond" ? (
              <polygon
                points={`${labelX},${element.y} ${element.x + element.width},${element.y + element.height / 2} ${labelX},${element.y + element.height} ${element.x},${element.y + element.height / 2}`}
                {...shapeProps}
              />
            ) : (
              <rect
                x={element.x}
                y={element.y}
                width={element.width}
                height={element.height}
                rx="13"
                {...shapeProps}
              />
            )}
            <text
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={focused ? "#d6faff" : "#e5edff"}
              fontSize="21"
              fontWeight="650"
            >
              {labelLines.map((line, index) => (
                <tspan key={`${element.id}-${index}`} x={labelX} dy={index === 0 ? 0 : 24}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EvidenceCard({
  item,
  onSelect,
  active,
}: {
  item: ReportEvidenceItem;
  onSelect: (item: ReportEvidenceItem) => void;
  active: boolean;
}) {
  const referenceCount =
    item.evidence.boardElementIds.length + item.evidence.transcriptSegmentIds.length;
  return (
    <button
      className={`${styles.judgment} ${active ? styles.activeEvidence : ""}`}
      onClick={() => onSelect(item)}
      aria-pressed={active}
    >
      <span>{Math.round(item.confidence * 100)}% confidence</span>
      <strong>{displayText(item.title)}</strong>
      <p>{displayText(item.explanation)}</p>
      <em>{referenceCount} evidence reference{referenceCount === 1 ? "" : "s"} →</em>
    </button>
  );
}

export function ReportView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshotIndex, setSnapshotIndex] = useState(0);
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await readApi<ReportPayload>(
          await fetch(`/api/interviews/${sessionId}/report`, { cache: "no-store" }),
        );
        setPayload(data);
        const initialEvidence =
          data.report.contradictionProbeRevision.detectedInconsistency ??
          data.report.contradictionProbeRevision.initialDecision;
        if (initialEvidence) {
          setSelectedEvidenceId(initialEvidence.id);
          setHighlightedIds(initialEvidence.evidence.boardElementIds);
          const evidenceSnapshotIndex = initialEvidence.evidence.snapshotId
            ? data.snapshots.findIndex(
                (snapshot) => snapshot.id === initialEvidence.evidence.snapshotId,
              )
            : -1;
          setSnapshotIndex(
            evidenceSnapshotIndex >= 0
              ? evidenceSnapshotIndex
              : Math.max(0, data.snapshots.length - 1),
          );
        } else {
          setSnapshotIndex(Math.max(0, data.snapshots.length - 1));
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load the report.");
      }
    })();
  }, [sessionId]);

  const selectEvidence = useCallback((item: ReportTimelineItem | ReportEvidenceItem) => {
    if (!payload) return;
    setSelectedEvidenceId(item.id);
    setHighlightedIds(item.evidence.boardElementIds);
    if (item.evidence.snapshotId) {
      const index = payload.snapshots.findIndex(
        (snapshot) => snapshot.id === item.evidence.snapshotId,
      );
      if (index >= 0) setSnapshotIndex(index);
    }
  }, [payload]);

  async function deleteSession() {
    if (!window.confirm("Delete this interview, transcripts, snapshots, and report permanently?")) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/interviews/${sessionId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("The session could not be deleted.");
      router.push("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The session could not be deleted.");
      setIsDeleting(false);
    }
  }

  if (!payload && !error) {
    return <main className={styles.fullState} role="status" aria-live="polite" aria-busy="true">Linking report judgments to interview evidence…</main>;
  }

  if (!payload) {
    return (
      <main className={styles.fullState}>
        <Brand />
        <h1>Report unavailable</h1>
        <p>{displayText(error ?? "The report could not be loaded.")}</p>
        <Link href="/interview/new" className="button-primary">Start another interview</Link>
      </main>
    );
  }

  const { report, snapshots } = payload;
  const sessionStart = payload.session.createdAt;
  const snapshot = snapshots[snapshotIndex] ?? null;
  const sequence = [
    ["01", "Initial decision", report.contradictionProbeRevision.initialDecision],
    ["02", "Detected inconsistency", report.contradictionProbeRevision.detectedInconsistency],
    ["03", "Interviewer probe", report.contradictionProbeRevision.interviewerProbe],
    ["04", "Candidate revision", report.contradictionProbeRevision.candidateRevision],
  ] as const;
  const sections = [
    ["Problem framing", report.problemFraming],
    ["Requirement discovery", report.requirementDiscovery],
    ["Decomposition", report.decomposition],
    ["Technical correctness", report.technicalCorrectness],
    ["Trade-off reasoning", report.tradeoffReasoning],
    ["Adaptability under challenge", report.adaptabilityUnderChallenge],
    ["Communication", report.communication],
  ] as const;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <div className={styles.headerActions}>
          <Link href={`/interview/${sessionId}`} className="button-quiet">Return to board</Link>
          <Link href={`/interview/${sessionId}/replay`} className="button-quiet">Open full replay</Link>
          <Link href="/interview/new" className="button-secondary">New interview</Link>
        </div>
      </header>

      <section className={`shell ${styles.hero}`}>
        <div>
          <h1>Your reasoning,<br /><span>replayed precisely.</span></h1>
          <p>This report separates observed evidence from evaluation. Select any judgment to inspect the transcript and exact board elements behind it.</p>
        </div>
        <div
          className={styles.scoreCard}
          role="meter"
          aria-label="Report confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(report.confidence * 100)}
        >
          <span>Report confidence</span>
          <strong>{Math.round(report.confidence * 100)}<small>%</small></strong>
          <p>{payload.events.length} events | {snapshots.length} board snapshots</p>
        </div>
      </section>

      <section className={`shell ${styles.signature}`}>
        <div className={styles.sectionTitle}>
          <div><h2>Contradiction → probe → revision</h2></div>
          <p>The sequence below is assembled from append-only event evidence.</p>
        </div>
        <div className={styles.sequence}>
          {sequence.map(([number, label, item]) => (
            <button
              key={number}
              className={`${styles.sequenceItem} ${item ? styles.hasEvidence : ""} ${item?.id === selectedEvidenceId ? styles.activeEvidence : ""}`}
              disabled={!item}
              onClick={() => item && selectEvidence(item)}
              aria-pressed={item ? item.id === selectedEvidenceId : undefined}
            >
              <span>{number}</span>
              <small>{label}</small>
              <strong>{item ? displayText(item.label) : "Not observed"}</strong>
              {item && <em>{shortTime(item.occurredAt, sessionStart)} | inspect evidence</em>}
            </button>
          ))}
        </div>
      </section>

      <section className={`shell ${styles.replaySection}`}>
        <div className={styles.replayHead}>
          <div><h2>Architecture at the selected moment</h2></div>
          <div className={styles.replayControls}>
            <button aria-label="Previous snapshot" onClick={() => setSnapshotIndex((index) => Math.max(0, index - 1))} disabled={snapshotIndex === 0}>←</button>
            <span>Snapshot {snapshots.length === 0 ? 0 : snapshotIndex + 1} / {snapshots.length}</span>
            <button aria-label="Next snapshot" onClick={() => setSnapshotIndex((index) => Math.min(snapshots.length - 1, index + 1))} disabled={snapshotIndex >= snapshots.length - 1}>→</button>
          </div>
        </div>
        <div className={styles.replayFrame}>
          <BoardReplay snapshot={snapshot} highlightedIds={highlightedIds} />
          <aside>
            <h3>{highlightedIds.length > 0 ? `${highlightedIds.length} exact element${highlightedIds.length === 1 ? "" : "s"} highlighted` : "Select a report moment"}</h3>
            <p>{highlightedIds.length > 0 ? "The sapphire glow marks only the stable board IDs cited by that judgment." : "Choose a sequence card or judgment to jump to its snapshot and focus its evidence."}</p>
            {highlightedIds.map((id) => <code key={id}>{id}</code>)}
          </aside>
        </div>
      </section>

      <section className={`shell ${styles.assessment}`}>
        <div className={styles.sectionTitle}>
          <div><h2>What the interview actually showed</h2></div>
        </div>
        <div className={styles.sectionGrid}>
          {sections.map(([title, section]) => (
            <article key={title} className={styles.competency}>
              <h3>{title}</h3>
              <p>{displayText(section.summary)}</p>
              {section.judgments.map((item) => (
                <EvidenceCard
                  key={item.id}
                  item={item}
                  onSelect={selectEvidence}
                  active={item.id === selectedEvidenceId}
                />
              ))}
            </article>
          ))}
        </div>
      </section>

      <section className={`shell ${styles.moments}`}>
        <EvidenceCard
          item={report.strongestObservedMoment}
          onSelect={selectEvidence}
          active={report.strongestObservedMoment.id === selectedEvidenceId}
        />
        <EvidenceCard
          item={report.mostImportantMissedIssue}
          onSelect={selectEvidence}
          active={report.mostImportantMissedIssue.id === selectedEvidenceId}
        />
      </section>

      <section className={`shell ${styles.practice}`}>
        <div className={styles.sectionTitle}>
          <div><h2>Three focused exercises</h2></div>
        </div>
        <div className={styles.practiceGrid}>
          {report.practiceExercises.map((exercise, index) => (
            <article key={exercise.id}><span>0{index + 1}</span><h3>{displayText(exercise.title)}</h3><p>{displayText(exercise.instruction)}</p><small>{displayText(exercise.rationale)}</small></article>
          ))}
        </div>
      </section>

      <footer className={`shell ${styles.footer}`}>
        <div><strong>Report limitations</strong>{report.limitations.map((limitation) => <p key={limitation}>{displayText(limitation)}</p>)}</div>
        <button className="button-danger" onClick={deleteSession} disabled={isDeleting}>{isDeleting ? "Deleting…" : "Delete session data"}</button>
      </footer>
    </main>
  );
}
