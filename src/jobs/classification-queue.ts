import type { Logger } from '../lib/logger.js';

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

  async requeue(findPendingIds: () => Promise<string[]>): Promise<number> {
    const ids = await findPendingIds();
    ids.forEach((id) => this.enqueue(id));
    return ids.length;
  }

  onIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

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
