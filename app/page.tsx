import Link from "next/link";
import { Brand } from "@/components/brand";
import styles from "./page.module.css";

const evidenceMoments = [
  { label: "Set the interview", copy: "Choose the format, target role, and experience level before the first question." },
  { label: "Talk or type", copy: "Use Gemini Live when enabled, or keep going with the independent text path." },
  { label: "Draw the answer", copy: "Build the system on a whiteboard while your explanation becomes transcript evidence." },
  { label: "Get one grounded probe", copy: "Sapphire cites the exact words and board elements behind its next question." }
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <nav className={`shell top-nav ${styles.nav}`} aria-label="Primary navigation">
        <Brand />
        <div className={styles.navActions}>
          <Link className="button-secondary" href="/interview/new">Set up an interview</Link>
        </div>
      </nav>

      <section className={`shell ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <h1>The interviewer that<br /><span>sees how you think.</span></h1>
          <p className={styles.lede}>
            Choose an interview, talk or type, and draw as you go. Sapphire ties each follow-up to your words and board.
          </p>
          <div className={styles.heroActions}>
            <Link className="button-primary" href="/interview/new">
              Set up your interview <span aria-hidden="true">→</span>
            </Link>
            <a className="button-quiet" href="#how-it-works">See the product loop</a>
          </div>
        </div>

        <div
          className={styles.heroVisual}
          role="img"
          aria-label="Preview of Sapphire connecting an interview brief, candidate explanation, and live whiteboard evidence"
        >
          <div className={styles.mockTopbar}>
            <div><span className={styles.miniMark} />System design</div>
            <span>Voice or text with whiteboard</span>
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
                <p>You want one limit. What stops a student from using it in both regions?</p>
              </div>
            </div>
            <aside className={styles.mockSidebar}>
              <h2>AI engineering internship</h2>
              <div className={styles.caption}>
                <span>Current prompt</span>
                <p>Give an AI study helper one shared usage limit.</p>
              </div>
              <div className={styles.caption}>
                <span>Candidate explanation</span>
                <p>Each student gets one shared limit across the US and EU.</p>
              </div>
              <div className={styles.analysisState}><span />Transcript and board ready</div>
            </aside>
          </div>
        </div>
      </section>

      <section className={`shell ${styles.signature}`} id="how-it-works">
        <div className={styles.sectionIntro}>
          <h2>One interview. Three connected inputs.</h2>
          <p>The brief sets the direction. Your voice or text carries the reasoning. The whiteboard supplies visible architecture evidence.</p>
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

      <section className={`shell ${styles.closing}`}>
        <div>
          <h2>Choose the interview before the first question.</h2>
        </div>
        <Link className="button-primary" href="/interview/new">Set up an interview</Link>
      </section>
    </main>
  );
}
