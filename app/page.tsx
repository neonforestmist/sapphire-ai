import Link from "next/link";
import { Brand } from "@/components/brand";
import styles from "./page.module.css";

const evidenceMoments = [
  { label: "Say the rule", copy: "“Each student gets one shared usage limit.”" },
  { label: "Spot the mismatch", copy: "The US and EU counters do not share updates." },
  { label: "Answer one question", copy: "What stops a student from using the limit in both regions?" },
  { label: "Improve the diagram", copy: "Connect both counters to one coordinator." }
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <nav className={`shell top-nav ${styles.nav}`} aria-label="Primary navigation">
        <Brand />
        <div className={styles.navActions}>
          <Link className="button-secondary" href="/interview/new">Try the practice</Link>
        </div>
      </nav>

      <section className={`shell ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <h1>The interviewer that<br /><span>sees how you think.</span></h1>
          <p className={styles.lede}>
            Try an AI intern prompt. Explain your idea, sketch four boxes, and get one follow-up tied to your diagram.
          </p>
          <div className={styles.heroActions}>
            <Link className="button-primary" href="/interview/new">
              Try the intern interview <span aria-hidden="true">→</span>
            </Link>
            <a className="button-quiet" href="#how-it-works">See how it works</a>
          </div>
          <div className={styles.trustRow} aria-label="Product capabilities">
            <span>No account</span><span>No advanced vocabulary</span><span>Evidence-linked report</span>
          </div>
        </div>

        <div
          className={styles.heroVisual}
          role="img"
          aria-label="Preview of Sapphire highlighting two disconnected regional counters for an AI study helper"
        >
          <div className={styles.mockTopbar}>
            <div><span className={styles.miniMark} />AI Engineering Intern</div>
            <span>Practice board</span>
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
              <h2>Give an AI study helper one shared usage limit.</h2>
              <div className={styles.caption}>
                <span>Your explanation</span>
                <p>Each student gets one shared limit across the US and EU.</p>
              </div>
              <div className={styles.analysisState}><span />Board evidence ready</div>
            </aside>
          </div>
        </div>
      </section>

      <section className={`shell ${styles.signature}`} id="how-it-works">
        <div className={styles.sectionIntro}>
          <h2>A small diagram with a clear lesson.</h2>
          <p>Sapphire connects your rule to your drawing, highlights the gap, and remembers how you fixed it.</p>
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
          <h2>See how one small change makes the idea stronger.</h2>
        </div>
        <Link className="button-primary" href="/interview/new">Try the practice</Link>
      </section>
    </main>
  );
}
