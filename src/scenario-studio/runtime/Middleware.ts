export interface Message { readonly type: string; }

export interface Channel<T extends Message> {
  readonly topic: string;
  readonly schemaName: string;
  readonly encoding: "application/json";
}

export interface SimulationTime { readonly seconds: number; readonly step: number; }
export interface MessageEvent<T extends Message> {
  readonly channel: Channel<T>;
  readonly message: T;
  readonly time: SimulationTime;
  readonly sequence: number;
  readonly sessionId: string;
  readonly runGeneration: number;
}
export interface Disposable { dispose(): void; }
export type Advertisement = Disposable;
export type Subscription = Disposable;
export type PublishResult = { readonly accepted: true; readonly sequence: number } | { readonly accepted: false; readonly reason: string };

export interface Middleware {
  advertise<T extends Message>(channel: Channel<T>): Advertisement;
  publish<T extends Message>(channel: Channel<T>, message: T, time: SimulationTime): PublishResult;
  subscribe<T extends Message>(channel: Channel<T>, handler: (event: MessageEvent<T>) => void): Subscription;
  beginRun(sessionId: string, runGeneration: number): void;
  dispose(): void;
}

/** Bounded synchronous router for browser-owned runtime participants. */
export class InProcessMiddleware implements Middleware {
  private readonly advertised = new Map<string, Channel<Message>>();
  private readonly handlers = new Map<string, Set<(event: MessageEvent<Message>) => void>>();
  private sequence = 0;
  private sessionId = "ready";
  private runGeneration = 0;
  private dispatchDepth = 0;
  private disposed = false;

  constructor(private readonly maxDispatchDepth = 32, private readonly maxSubscribersPerChannel = 128) {}

  beginRun(sessionId: string, runGeneration: number): void {
    if (this.disposed) throw new Error("Runtime middleware was disposed.");
    this.sessionId = sessionId;
    this.runGeneration = runGeneration;
    this.sequence = 0;
  }

  advertise<T extends Message>(channel: Channel<T>): Advertisement {
    this.assertActive();
    const existing = this.advertised.get(channel.topic);
    if (existing && (existing.schemaName !== channel.schemaName || existing.encoding !== channel.encoding)) throw new Error(`Channel ${channel.topic} is already advertised with another schema.`);
    this.advertised.set(channel.topic, channel as Channel<Message>);
    let active = true;
    return { dispose: () => { if (!active) return; active = false; if (this.advertised.get(channel.topic) === channel) this.advertised.delete(channel.topic); } };
  }

  subscribe<T extends Message>(channel: Channel<T>, handler: (event: MessageEvent<T>) => void): Subscription {
    this.assertActive();
    const handlers = this.handlers.get(channel.topic) ?? new Set();
    if (handlers.size >= this.maxSubscribersPerChannel) throw new Error(`Channel ${channel.topic} has too many subscribers.`);
    const erased = handler as (event: MessageEvent<Message>) => void;
    handlers.add(erased);
    this.handlers.set(channel.topic, handlers);
    let active = true;
    return { dispose: () => { if (!active) return; active = false; handlers.delete(erased); if (!handlers.size) this.handlers.delete(channel.topic); } };
  }

  publish<T extends Message>(channel: Channel<T>, message: T, time: SimulationTime): PublishResult {
    if (this.disposed) return { accepted: false, reason: "Runtime middleware was disposed." };
    const advertised = this.advertised.get(channel.topic);
    if (!advertised) return { accepted: false, reason: `Channel ${channel.topic} is not advertised.` };
    if (advertised.schemaName !== channel.schemaName) return { accepted: false, reason: `Channel ${channel.topic} schema does not match its advertisement.` };
    if (!message || typeof message !== "object" || typeof message.type !== "string" || !message.type) return { accepted: false, reason: `Channel ${channel.topic} received an invalid message.` };
    if (!Number.isFinite(time.seconds) || !Number.isSafeInteger(time.step) || time.step < 0) return { accepted: false, reason: `Channel ${channel.topic} received an invalid simulation timestamp.` };
    if (this.dispatchDepth >= this.maxDispatchDepth) return { accepted: false, reason: `Channel ${channel.topic} exceeded the bounded dispatch depth.` };
    const sequence = ++this.sequence;
    const event: MessageEvent<T> = Object.freeze({ channel, message, time, sequence, sessionId: this.sessionId, runGeneration: this.runGeneration });
    this.dispatchDepth++;
    try { for (const handler of [...(this.handlers.get(channel.topic) ?? [])]) handler(event as MessageEvent<Message>); }
    finally { this.dispatchDepth--; }
    return { accepted: true, sequence };
  }

  dispose(): void { if (!this.disposed) { this.disposed = true; this.advertised.clear(); this.handlers.clear(); } }
  private assertActive(): void { if (this.disposed) throw new Error("Runtime middleware was disposed."); }
}

export const channel = <T extends Message>(topic: string, schemaName: string): Channel<T> => Object.freeze({ topic, schemaName, encoding: "application/json" });
