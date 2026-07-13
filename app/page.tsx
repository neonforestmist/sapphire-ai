import Link from "next/link";
import { Brand } from "@/components/brand";
import styles from "./page.module.css";

const evidenceMoments = [
  { time: "02:14", label: "Spoken requirement", copy: "“Quotas must remain globally consistent.”" },
  { time: "02:31", label: "Board mismatch", copy: "Regional stores have no shared state." },
  { time: "02:36", label: "Sapphire probe", copy: "What prevents a user from consuming the quota twice?" },
  { time: "03:08", label: "Candidate revision", copy: "Adds a global coordination path." }
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <nav className={`shell top-nav ${styles.nav}`} aria-label="Primary navigation">
        <Brand />
        <div className={styles.navActions}>
          <Link className="button-secondary" href="/interview/new">Start interview</Link>
        </div>
      </nav>

      <section className={`shell ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <h1>The interviewer that<br /><span>sees how you think.</span></h1>
          <p className={styles.lede}>
            Sapphire listens to your reasoning, watches your architecture evolve, and asks the one
            follow-up grounded in the exact elements on your board.
          </p>
          <div className={styles.heroActions}>
            <Link className="button-primary" href="/interview/new">
              Practice system design <span aria-hidden="true">→</span>
            </Link>
            <a className="button-quiet" href="#how-it-works">See the signature moment</a>
          </div>
          <div className={styles.trustRow} aria-label="Product capabilities">
            <span>No account</span><span>Text fallback</span><span>Evidence-linked report</span>
          </div>
        </div>

        <div
          className={styles.heroVisual}
          role="img"
          aria-label="Preview of Sapphire highlighting two disconnected regional stores and asking how they share quota state"
        >
          <div className={styles.mockTopbar}>
            <div><span className={styles.miniMark} />System Design</div>
            <span>Solution construction · 02:36</span>
          </div>
          <div className={styles.mockRoom}>
            <div className={styles.boardPreview}>
              <div className={`${styles.boardNode} ${styles.usApi}`}>US API</div>
              <div className={`${styles.boardNode} ${styles.euApi}`}>EU API</div>
              <div className={`${styles.boardNode} ${styles.redisUs} ${styles.focused}`}>US Redis</div>
              <div className={`${styles.boardNode} ${styles.redisEu} ${styles.focused}`}>EU Redis</div>
              <div className={`${styles.arrow} ${styles.arrowUs}`} />
              <div className={`${styles.arrow} ${styles.arrowEu}`} />
              <div className={styles.focusLabel}>2 elements referenced</div>
              <div className={styles.probeCard}>
                <p>You said the quota is globally consistent. How do these stores share state?</p>
              </div>
            </div>
            <aside className={styles.mockSidebar}>
              <h2>Design a globally distributed API rate limiter.</h2>
              <div className={styles.caption}>
                <span>You · 02:14</span>
                <p>Quotas must remain globally consistent across regions.</p>
              </div>
              <div className={styles.analysisState}><span />Board evidence ready</div>
            </aside>
          </div>
        </div>
      </section>

      <section className={`shell ${styles.signature}`} id="how-it-works">
        <div className={styles.sectionIntro}>
          <h2>Not a generic chat. A replay of observable reasoning.</h2>
          <p>Sapphire connects what you said to what changed on the board, without guessing at private thought.</p>
        </div>
        <div className={styles.timeline}>
          {evidenceMoments.map((moment, index) => (
            <article key={moment.label} className={styles.moment}>
              <div className={styles.momentIndex}>{String(index + 1).padStart(2, "0")}</div>
              <time>{moment.time}</time>
              <h3>{moment.label}</h3>
              <p>{moment.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`shell ${styles.closing}`}>
        <div>
          <h2>Practice the part interview prep usually misses.</h2>
        </div>
        <Link className="button-primary" href="/interview/new">Open the whiteboard</Link>
      </section>
    </main>
  );
}
