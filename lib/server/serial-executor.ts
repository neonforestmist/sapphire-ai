/**
 * A small process-local critical section for append-only session mutations.
 * The Firestore repository still enforces sequence numbers transactionally;
 * this prevents ordinary same-instance requests from racing before they reach it.
 */
export class KeyedSerialExecutor {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, current);

    if (prior) {
      await prior;
    }

    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === current) {
        this.tails.delete(key);
      }
    }
  }
}
