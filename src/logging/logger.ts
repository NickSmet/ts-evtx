export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  trace: (msg: any, ...args: any[]) => void;
  debug: (msg: any, ...args: any[]) => void;
  info: (msg: any, ...args: any[]) => void;
  warn: (msg: any, ...args: any[]) => void;
  error: (msg: any, ...args: any[]) => void;
  /** Return a child logger with a namespace/prefix */
  child: (namespace: string) => Logger;
}

class NoopLogger implements Logger {
  trace() {}
  debug() {}
  info() {}
  warn() {}
  error() {}
  child() { return this; }
}

/**
 * Default logger is a no-op to keep the library silent by default.
 * Consumers can call setLogger(...) to enable logging.
 */
let currentLogger: Logger = new NoopLogger();

export function setLogger(logger: Logger) {
  currentLogger = logger ?? new NoopLogger();
}

export function getLogger(namespace?: string): Logger {
  return namespace ? currentLogger.child(namespace) : currentLogger;
}

/**
 * A simple console-backed logger for consumers/tests. Not used by the library by default.
 */
export class ConsoleLogger implements Logger {
  private prefix: string;
  constructor(namespace?: string) {
    this.prefix = namespace ? `[${namespace}]` : '';
  }
  private pre(msg: any) { return this.prefix ? `${this.prefix} ${msg}` : msg; }
  trace(msg: any, ...args: any[]) { console.debug(this.pre(msg), ...args); }
  debug(msg: any, ...args: any[]) { console.debug(this.pre(msg), ...args); }
  info(msg: any, ...args: any[]) { console.info(this.pre(msg), ...args); }
  warn(msg: any, ...args: any[]) { console.warn(this.pre(msg), ...args); }
  error(msg: any, ...args: any[]) { console.error(this.pre(msg), ...args); }
  child(namespace: string): Logger { return new ConsoleLogger(namespace); }
}

const levelRank: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

class LevelFilterLogger implements Logger {
  constructor(private inner: Logger, private min: LogLevel, private ns?: string) {}
  private allow(level: LogLevel) { return levelRank[level] >= levelRank[this.min]; }
  trace(msg: any, ...args: any[]) { if (this.allow('trace')) this.inner.trace(msg, ...args); }
  debug(msg: any, ...args: any[]) { if (this.allow('debug')) this.inner.debug(msg, ...args); }
  info(msg: any, ...args: any[]) { if (this.allow('info')) this.inner.info(msg, ...args); }
  warn(msg: any, ...args: any[]) { if (this.allow('warn')) this.inner.warn(msg, ...args); }
  error(msg: any, ...args: any[]) { if (this.allow('error')) this.inner.error(msg, ...args); }
  child(namespace: string): Logger { return new LevelFilterLogger(this.inner.child(namespace), this.min, namespace); }
}

/** Wrap an existing logger with a minimum level threshold */
export function withMinLevel(logger: Logger, min: LogLevel): Logger {
  return new LevelFilterLogger(logger, min);
}
