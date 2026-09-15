/** All event entry points share this queue, including alarms. Awaited network
 * calls can interleave in Durable Objects, so storage alone is not a mutex. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
