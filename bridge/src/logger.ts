/**
 * Command logging.
 *
 * One line per command with a short argument digest; full payloads only in
 * verbose mode, because a single project-state response can be megabytes and
 * would bury everything useful.
 */

export type LogLevel = 'silent' | 'info' | 'debug';

const MAX_DIGEST = 160;

export class Logger {
  level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private stamp(): string {
    return new Date().toISOString();
  }

  info(message: string): void {
    if (this.level === 'silent') return;
    process.stderr.write(`${this.stamp()} ${message}\n`);
  }

  debug(message: string): void {
    if (this.level !== 'debug') return;
    process.stderr.write(`${this.stamp()} DEBUG ${message}\n`);
  }

  command(id: string, command: string, args: Record<string, unknown>): void {
    if (this.level === 'silent') return;
    this.info(`COMMAND ${command} ${digest(args)} [${id}]`);
    this.debug(`  args ${safeJson(args)}`);
  }

  result(id: string, command: string, ms: number, ok: boolean, result?: unknown): void {
    if (this.level === 'silent') return;
    this.info(`RESULT  ${ok ? 'OK' : 'FAIL'} ${command} ${ms.toFixed(0)}ms [${id}]`);
    if (ok) this.debug(`  result ${safeJson(result)}`);
  }

  failure(id: string, command: string, code: string, message: string): void {
    if (this.level === 'silent') return;
    this.info(`ERROR   ${command} ${code}: ${message} [${id}]`);
  }
}

/** A short, bounded summary of arguments - never the whole note array. */
function digest(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args ?? {})) {
    if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length}]`);
    } else if (value !== null && typeof value === 'object') {
      parts.push(`${key}={...}`);
    } else if (typeof value === 'string') {
      parts.push(`${key}=${JSON.stringify(value.slice(0, 32))}`);
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }
  const joined = parts.join(' ');
  return joined.length > MAX_DIGEST ? `${joined.slice(0, MAX_DIGEST)}...` : joined;
}

function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? 'undefined' : text;
  } catch {
    return '<unserializable>';
  }
}

export const logger = new Logger(
  process.env.TROUBLEMAKER_LOG_LEVEL === 'debug'
    ? 'debug'
    : process.env.TROUBLEMAKER_LOG_LEVEL === 'silent'
      ? 'silent'
      : 'info',
);
