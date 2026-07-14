import Link from "next/link";
import { Brand } from "@/components/brand";
import styles from "./page.module.css";

const evidenceMoments = [
  { label: "Set the interview", copy: "Choose the format, target role, and experience level before the first question." },
  { label: "Talk or type", copy: "Use Gemini Live when enabled, or keep going with the independent text path." },
  { label: "Use the board when useful", copy: "Map architecture or a workflow, or keep the board hidden for a conversational round." },
  { label: "Get one grounded probe", copy: "Sapphire cites the exact words and board elements behind its next question." }
];

const useCases = [
  { title: "System design", example: "Map services, state, and trade-offs.", board: "Board useful" },
  { title: "Technical explanation", example: "Explain an evaluation or debugging plan.", board: "Board optional" },
  { title: "Case study", example: "Structure a messy problem and recommendation.", board: "Board optional" },
  { title: "Behavioral", example: "Practice a specific story through conversation.", board: "Board hidden by default" },
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <nav className={`shell top-nav ${styles.nav}`} aria-label="Primary navigation">
        <Brand />
      </nav>

      <section className={`shell ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <h1>The interviewer that<br /><span>can see how you think.</span></h1>
          <p className={styles.lede}>
            Type or speak in the same session. Open the whiteboard only when it helps. Sapphire ties each follow-up to observable evidence.
          </p>
          <div className={styles.methodLine} aria-label="Sapphire interview method">
            <span>Set the brief</span>
            <span>Explain</span>
            <span>Map</span>
            <span>Challenge</span>
            <span>Revise</span>
          </div>
          <div className={styles.heroActions}>
            <Link className="button-primary" href="/interview/new">
              Set up your interview <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <div
          className={styles.heroVisual}
          role="img"
          aria-label="Preview of Sapphire connecting an interview brief, candidate explanation, and live whiteboard evidence"
        >
          <div className={styles.mockTopbar}>
            <div><span className={styles.miniMark} />System design</div>
            <span>Text and audio, board optional</span>
          </div>
          <div className={styles.mockRoom}>
            <div className={styles.boardPreview}>
              <div className={`${styles.boardNode} ${styles.usApi}`}>US API</div>
              <div className={`${styles.boardNode} ${styles.euApi}`}>EU API</div>
              <div className={`${styles.boardNode} ${styles.redisUs} ${styles.focused}`}>US counter</div>
              <div className={`${styles.boardNode} ${styles.redisEu} ${styles.focused}`}>EU counter</div>
              <div className={`${styles.arrow} ${styles.arrowUs}`} />
              <div className={`${styles.arrow} ${styles.arrowEu}`} />
              <div className={styles.focusLabel}>2 elements referenced</div>
              <div className={styles.probeCard}>
                <p>You want one limit. What stops a user from using it in both regions?</p>
              </div>
            </div>
            <aside className={styles.mockSidebar}>
              <h2>AI engineering internship</h2>
              <div className={styles.caption}>
                <span>Current prompt</span>
                <p>Give an app one shared usage limit for each user.</p>
              </div>
              <div className={styles.caption}>
                <span>Candidate explanation</span>
                <p>Each user gets one shared limit across the US and EU.</p>
              </div>
              <div className={styles.analysisState}><span />Transcript and board ready</div>
            </aside>
          </div>
        </div>
      </section>

      <section className={`shell ${styles.useCases}`}>
        <div className={styles.sectionIntro}>
          <h2>Practice the interview in front of you.</h2>
          <p>Use the same focused room for a diagram-heavy technical round or a conversation without a board.</p>
        </div>
        <div className={styles.useCaseGrid}>
          {useCases.map((useCase) => (
            <article className={styles.useCase} key={useCase.title}>
              <h3>{useCase.title}</h3>
              <p>{useCase.example}</p>
              <span>{useCase.board}</span>
            </article>
          ))}
        </div>
      </section>

      <section className={`shell ${styles.signature}`} id="how-it-works">
        <div className={styles.sectionIntro}>
          <h2>One interview. Three connected inputs.</h2>
          <p>The brief sets the direction. Voice and text share the conversation. The whiteboard adds visual evidence when you use it.</p>
        </div>
        <div className={styles.timeline}>
          {evidenceMoments.map((moment) => (
            <article key={moment.label} className={styles.moment}>
              <h3>{moment.label}</h3>
              <p>{moment.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
