"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { displayText } from "@/components/display-text";
import styles from "./interview-setup.module.css";

type InputMode = "text" | "voice";

export function InterviewSetup() {
  const router = useRouter();
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [consent, setConsent] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function beginInterview() {
    if (!consent || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: "global-rate-limiter",
          inputMode,
          consent: { transcript: true, microphone: inputMode === "voice" }
        })
      });
      const body = (await response.json()) as { data?: { sessionId: string }; error?: { message: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Could not create the interview.");
      router.push(`/interview/${body.data.sessionId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the interview.");
      setIsCreating(false);
    }
  }

  return (
    <main className={styles.page}>
      <nav className={`shell top-nav ${styles.nav}`} aria-label="Setup navigation"><Brand /><Link className="button-quiet" href="/">Exit setup</Link></nav>
      <div className={`shell ${styles.layout}`}>
        <section className={styles.intro}>
          <h1>System design,<br />under observation.</h1>
          <p>You’ll have a live whiteboard, one focused prompt, and an interviewer that grounds follow-ups in observable evidence.</p>
          <ol>
            <li><span>01</span><div><strong>Clarify the problem</strong><p>State requirements and assumptions aloud or in text.</p></div></li>
            <li><span>02</span><div><strong>Build on the board</strong><p>Use boxes, labels, arrows, edits, and deletions naturally.</p></div></li>
            <li><span>03</span><div><strong>Review the evidence</strong><p>Replay the decisions, probes, and revisions that mattered.</p></div></li>
          </ol>
        </section>

        <section className={`glass-panel ${styles.form}`} aria-labelledby="setup-heading">
          <div className={styles.formHeading}>
            <h2 id="setup-heading">Prepare your session</h2>
            <p>4-6 minute demo path | no account required</p>
          </div>

          <fieldset className={styles.fieldset}>
            <legend>How would you like to respond?</legend>
            <label className={`${styles.modeCard} ${inputMode === "text" ? styles.selected : ""}`}>
              <input type="radio" name="input-mode" value="text" checked={inputMode === "text"} onChange={() => setInputMode("text")} />
              <span className={styles.modeIcon} aria-hidden="true">⌨</span>
              <span><strong>Text fallback</strong><small>Reliable and ready without permissions</small></span>
              <span className={styles.radioMark} aria-hidden="true" />
            </label>
            <label className={`${styles.modeCard} ${styles.disabledMode}`}>
              <input type="radio" name="input-mode" value="voice" checked={false} disabled onChange={() => setInputMode("voice")} />
              <span className={styles.modeIcon} aria-hidden="true">◉</span>
              <span><strong>Voice + captions</strong><small>Available after Live transport is verified</small></span>
              <span className={styles.radioMark} aria-hidden="true" />
            </label>
          </fieldset>

          <div className={styles.scenario}>
            <h3>Design a globally distributed API rate limiter.</h3>
            <p>Focus on consistency, latency, failure modes, and how state moves between regions.</p>
          </div>

          <label className={styles.consent}>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I consent to storing finalized transcript text and selected board snapshots for this session. Raw microphone audio is not stored.</span>
          </label>

          {error && <p className={styles.error} role="alert">{displayText(error)}</p>}
          <button type="button" className={`button-primary ${styles.submit}`} disabled={!consent || isCreating} onClick={beginInterview}>
            {isCreating ? "Opening whiteboard…" : "Enter interview room"}<span aria-hidden="true">→</span>
          </button>
          <p className={styles.privacyNote}>You can delete the full session and its artifacts from the report.</p>
        </section>
      </div>
    </main>
  );
}
