"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { displayText } from "@/components/display-text";
import styles from "./interview-setup.module.css";

type InputMode = "text" | "voice";
type ExperienceLevel = "intern" | "early-career" | "mid-level" | "senior";

export function InterviewSetup() {
  const router = useRouter();
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [targetRole, setTargetRole] = useState("AI engineering internship");
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("intern");
  const [consent, setConsent] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function beginInterview() {
    if (!consent || targetRole.trim().length < 2 || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: "global-rate-limiter",
          interviewType: "system-design",
          targetRole,
          experienceLevel,
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
          <h1>Set the interview.<br />Then think out loud.</h1>
          <p>Choose what you are practicing, speak or type your reasoning, and build the answer on a live whiteboard.</p>
          <ol>
            <li><div><strong>Choose the interview</strong><p>Set the format, target role, and experience level.</p></div></li>
            <li><div><strong>Explain while you draw</strong><p>Use text today, with Gemini Live voice planned as the conversational path.</p></div></li>
            <li><div><strong>Get a grounded follow-up</strong><p>Sapphire connects what you said to the exact elements on your board.</p></div></li>
          </ol>
        </section>

        <section className={`glass-panel ${styles.form}`} aria-labelledby="setup-heading">
          <div className={styles.formHeading}>
            <h2 id="setup-heading">Set up a practice round</h2>
            <p>Choose the interview before the whiteboard opens</p>
          </div>

          <div className={styles.briefFields}>
            <label className={styles.inputField}>
              <span>Interview format</span>
              <select defaultValue="system-design" disabled aria-describedby="format-help">
                <option value="system-design">System design</option>
              </select>
              <small id="format-help">The verified demo currently supports system design.</small>
            </label>
            <label className={styles.inputField}>
              <span>Experience level</span>
              <select value={experienceLevel} onChange={(event) => setExperienceLevel(event.target.value as ExperienceLevel)}>
                <option value="intern">Intern</option>
                <option value="early-career">Early career</option>
                <option value="mid-level">Mid-level</option>
                <option value="senior">Senior</option>
              </select>
            </label>
            <label className={`${styles.inputField} ${styles.roleField}`}>
              <span>Target role</span>
              <input required value={targetRole} maxLength={120} onChange={(event) => setTargetRole(event.target.value)} />
              <small>Sapphire uses this role in the interview blueprint.</small>
            </label>
          </div>

          <fieldset className={styles.fieldset}>
            <legend>How do you want to think out loud?</legend>
            <label className={`${styles.modeCard} ${inputMode === "text" ? styles.selected : ""}`}>
              <input type="radio" name="input-mode" value="text" checked={inputMode === "text"} onChange={() => setInputMode("text")} />
              <span className={styles.modeIcon} aria-hidden="true">⌨</span>
              <span><strong>Type your answer</strong><small>Quick, reliable, and permission-free</small></span>
              <span className={styles.radioMark} aria-hidden="true" />
            </label>
            <label className={`${styles.modeCard} ${styles.disabledMode}`}>
              <input type="radio" name="input-mode" value="voice" checked={false} disabled onChange={() => setInputMode("voice")} />
              <span className={styles.modeIcon} aria-hidden="true">◉</span>
              <span><strong>Gemini Live voice</strong><small>Browser audio transport is not connected yet</small></span>
              <span className={styles.radioMark} aria-hidden="true" />
            </label>
          </fieldset>

          <div className={styles.scenario}>
            <h3>Give an AI study helper one shared usage limit.</h3>
            <p>Students may use the helper from the US or EU. Each student gets 10 answers per minute total.</p>
          </div>

          <label className={styles.consent}>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I consent to storing finalized transcript text and selected board snapshots for this session. Raw microphone audio is not stored.</span>
          </label>

          {error && <p className={styles.error} role="alert">{displayText(error)}</p>}
          <button type="button" className={`button-primary ${styles.submit}`} disabled={!consent || targetRole.trim().length < 2 || isCreating} onClick={beginInterview}>
            {isCreating ? "Opening whiteboard…" : "Start text practice"}<span aria-hidden="true">→</span>
          </button>
          <p className={styles.privacyNote}>You can delete the full session and its artifacts from the report.</p>
        </section>
      </div>
    </main>
  );
}
