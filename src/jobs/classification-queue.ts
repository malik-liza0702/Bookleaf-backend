import type { Logger } from '../lib/logger.js';

/**
 * A minimal in-process job queue for ticket classification.
 *
 * Why not Redis/BullMQ: one API instance and a few tickets a minute do not
 * justify another piece of infrastructure. The trade-off is that queued jobs
 * live in memory, so on boot we re-queue every ticket still marked
 * `aiStatus: "pending"` (see `requeue`), which covers crashes and restarts.
 *
 * Jobs start on a later tick (setImmediate), so creating a ticket returns its
 * 201 before any AI work begins, and a bounded concurrency keeps a burst of
 * tickets from hammering the model's rate limit.
 */
export class ClassificationQueue {
  private readonly waiting: string[] = [];
  private readonly queued = new Set<string>();
  private active = 0;
  private stopped = false;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly worker: (ticketId: string) => Promise<void>,
    private readonly logger: Logger,
    private readonly concurrency = 2,
  ) {}

  enqueue(ticketId: string): void {
    if (this.stopped || this.queued.has(ticketId)) return;
    this.queued.add(ticketId);
    this.waiting.push(ticketId);
    setImmediate(() => this.pump());
  }

  /** Re-queues work that was pending when the process last stopped. */
  async requeue(findPendingIds: () => Promise<string[]>): Promise<number> {
    const ids = await findPendingIds();
    ids.forEach((id) => this.enqueue(id));
    return ids.length;
  }

  /** Resolves once nothing is queued or running. Used by tests and shutdown. */
  onIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Stops accepting jobs and waits for running ones to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.waiting.length = 0;
    this.queued.clear();
    await this.onIdle();
  }

  private isIdle(): boolean {
    return this.active === 0 && this.waiting.length === 0;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const ticketId = this.waiting.shift()!;
      this.active += 1;
      this.worker(ticketId)
        .catch((err: unknown) => this.logger.error({ err, ticketId }, 'Classification job failed'))
        .finally(() => {
          this.active -= 1;
          this.queued.delete(ticketId);
          this.pump();
          if (this.isIdle()) {
            this.idleWaiters.forEach((resolve) => resolve());
            this.idleWaiters = [];
          }
        });
    }
  }
}
