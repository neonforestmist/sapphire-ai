"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Brand } from "@/components/brand";
import { displayText } from "@/components/display-text";
import { BoardReplay } from "@/components/report/report-view";
import type {
  BoardSnapshotRecord,
  FinalReport,
  InterviewSession,
  SessionEvent,
  TranscriptSegment,
} from "@/lib/interview/schemas";

import styles from "./replay-view.module.css";

type ApiEnvelope<T> = { data?: T; error?: { message: string } };
type ReplayPayload = {
  report: FinalReport;
  session: InterviewSession;
  events: SessionEvent[];
  snapshots: BoardSnapshotRecord[];
};

function relativeTime(timestamp: number, start: number): string {
  const seconds = Math.max(0, Math.round((timestamp - start) / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ReplayView({ sessionId }: { sessionId: string }) {
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/interviews/${sessionId}/report`, {
          cache: "no-store",
        });
        const body = (await response.json()) as ApiEnvelope<ReplayPayload>;
        if (!response.ok || !body.data) {
          throw new Error(body.error?.message ?? "The replay could not be loaded.");
        }
        setPayload(body.data);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The replay could not be loaded.");
      }
    })();
  }, [sessionId]);

  const transcripts = useMemo<TranscriptSegment[]>(() => {
    if (!payload) return [];
    return payload.events
      .filter((event) =>
        event.type === "transcript.input.finalized" ||
        event.type === "transcript.output.finalized",
      )
      .map((event) => event.payload.segment)
      .sort((left, right) => left.startedAt - right.startedAt);
  }, [payload]);

  if (!payload && !error) {
    return <main className={styles.fullState} role="status" aria-live="polite" aria-busy="true">Reconstructing the board and transcript timeline…</main>;
  }

  if (!payload) {
    return (
      <main className={styles.fullState}>
        <Brand />
        <h1>Replay unavailable</h1>
        <p>{displayText(error ?? "The replay could not be loaded.")}</p>
        <Link className="button-primary" href={`/interview/${sessionId}/report`}>Return to report</Link>
      </main>
    );
  }

  const snapshot = payload.snapshots[selectedIndex] ?? null;
  const focusedEvent = [...payload.events]
    .reverse()
    .find(
      (event) =>
        event.type === "board.elements.focused" &&
        event.payload.snapshotId === snapshot?.id,
    );
  const highlightedIds =
    focusedEvent?.type === "board.elements.focused"
      ? focusedEvent.payload.elementIds
      : [];
  const visibleTranscripts = transcripts.filter(
    (segment) => !snapshot || segment.endedAt <= snapshot.createdAt,
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <div>
          <Link className="button-quiet" href={`/interview/${sessionId}`}>Return to board</Link>
          <Link className="button-secondary" href={`/interview/${sessionId}/report`}>Back to report</Link>
        </div>
      </header>

      <section className={styles.titleBar}>
        <div>
          <h1>Board evolution + transcript evidence</h1>
        </div>
        <p>Each checkpoint is a persisted scene with stable element IDs. Transcript rows appear only once they existed at that moment.</p>
      </section>

      <div className={styles.layout}>
        <section className={styles.boardArea}>
          <div className={styles.boardHead}>
            <div><strong>Whiteboard checkpoint</strong><span>{snapshot ? relativeTime(snapshot.createdAt, payload.session.createdAt) : "No snapshot"}</span></div>
            {highlightedIds.length > 0 && <em>{highlightedIds.length} cited element{highlightedIds.length === 1 ? "" : "s"} focused</em>}
          </div>
          <div className={styles.boardFrame}>
            <BoardReplay snapshot={snapshot} highlightedIds={highlightedIds} />
          </div>
          <div className={styles.snapshotRail} aria-label="Board snapshot timeline">
            {payload.snapshots.map((item, index) => (
              <button
                key={item.id}
                className={index === selectedIndex ? styles.activeSnapshot : ""}
                onClick={() => setSelectedIndex(index)}
              >
                <span>{index + 1}</span>
                <strong>{index === 0 ? "Initial architecture" : "Candidate revision"}</strong>
                <small>{relativeTime(item.createdAt, payload.session.createdAt)}</small>
              </button>
            ))}
          </div>
        </section>

        <aside className={styles.transcript}>
          <div className={styles.transcriptHead}>
            <h2>Transcript</h2>
            <strong>{visibleTranscripts.length} evidence segment{visibleTranscripts.length === 1 ? "" : "s"}</strong>
          </div>
          <div className={styles.transcriptList}>
            {visibleTranscripts.map((segment) => (
              <article key={segment.id}>
                <div><span>{segment.speaker}</span><time>{relativeTime(segment.startedAt, payload.session.createdAt)}</time></div>
                <p>{displayText(segment.text)}</p>
                <code>{segment.id}</code>
              </article>
            ))}
            {visibleTranscripts.length === 0 && <p className={styles.empty}>No finalized transcript existed at this checkpoint.</p>}
          </div>
          <div className={styles.provenance}>
            <strong>Replay provenance</strong>
            <p>{payload.events.length} append-only events</p>
            <p>{payload.snapshots.length} normalized board scenes</p>
            <p>Raw microphone audio not stored</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
