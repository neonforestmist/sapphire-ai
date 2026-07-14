"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { displayText } from "@/components/display-text";
import styles from "./interview-setup.module.css";

type InterviewType = "system-design" | "technical-explanation" | "case-study" | "behavioral";
type ExperienceLevel = "intern" | "early-career" | "mid-level" | "senior";

const PRACTICE_EXAMPLES: Record<InterviewType, { title: string; description: string }> = {
  "system-design": {
    title: "Design one shared usage limit for an AI study helper.",
    description: "Talk through the architecture and use the board when a diagram helps.",
  },
  "technical-explanation": {
    title: "Explain how you would evaluate an AI assistant before launch.",
    description: "A conversational technical interview with the board available when useful.",
  },
  "case-study": {
    title: "Help a support team reduce response time without lowering quality.",
    description: "Structure the problem aloud, test assumptions, and sketch only if it adds clarity.",
  },
  behavioral: {
    title: "Describe a time you learned an unfamiliar tool quickly.",
    description: "A voice-first practice round that works without opening the whiteboard.",
  },
};

export function InterviewSetup() {
  const router = useRouter();
  const [interviewType, setInterviewType] = useState<InterviewType>("system-design");
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
          interviewType,
          targetRole,
          experienceLevel,
          inputMode: "voice",
          consent: { transcript: true, microphone: true }
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
          <p>Type or speak in the same session. Open the whiteboard when drawing helps your answer.</p>
          <ol>
            <li><div><strong>Choose the interview</strong><p>Set the format, target role, and experience level.</p></div></li>
            <li><div><strong>Talk, type, or draw</strong><p>The microphone starts muted. Text and the optional board stay available throughout.</p></div></li>
            <li><div><strong>Get a grounded follow-up</strong><p>Sapphire connects what you said to the exact elements on your board.</p></div></li>
          </ol>
        </section>

        <section className={`glass-panel ${styles.form}`} aria-labelledby="setup-heading">
          <div className={styles.formHeading}>
            <h2 id="setup-heading">Set up a practice round</h2>
            <p>Choose the interview before the first question</p>
          </div>

          <div className={styles.briefFields}>
            <label className={styles.inputField}>
              <span>Interview format</span>
              <select value={interviewType} onChange={(event) => setInterviewType(event.target.value as InterviewType)} aria-describedby="format-help">
                <option value="system-design">System design</option>
                <option value="technical-explanation">Technical explanation</option>
                <option value="case-study">Case study</option>
                <option value="behavioral">Behavioral</option>
              </select>
              <small id="format-help">You can still show or hide the whiteboard during the interview.</small>
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

          <div className={styles.scenario}>
            <h3>{PRACTICE_EXAMPLES[interviewType].title}</h3>
            <p>{PRACTICE_EXAMPLES[interviewType].description}</p>
          </div>

          <label className={styles.consent}>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I consent to finalized transcript storage, selected board snapshots, and microphone processing only after I unmute. Raw audio is not stored.</span>
          </label>

          {error && <p className={styles.error} role="alert">{displayText(error)}</p>}
          <button type="button" className={`button-primary ${styles.submit}`} disabled={!consent || targetRole.trim().length < 2 || isCreating} onClick={beginInterview}>
            {isCreating ? "Opening interview…" : "Start interview"}<span aria-hidden="true">→</span>
          </button>
          <p className={styles.privacyNote}>You can delete the full session and its artifacts from the report.</p>
        </section>
      </div>
    </main>
  );
}
