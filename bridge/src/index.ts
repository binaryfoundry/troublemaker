#!/usr/bin/env node
/**
 * Bridge entry point.
 *
 * Environment:
 *   TROUBLEMAKER_PORT       bridge HTTP/WS port        (default 8765)
 *   TROUBLEMAKER_LIVE_PORT  Remote Script TCP port     (default 9877)
 *   TROUBLEMAKER_LOG_LEVEL  silent | info | debug      (default info)
 */

import { Bridge } from './server.js';
import { logger } from './logger.js';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    logger.info(`ignoring invalid ${name}=${raw}; using ${fallback}`);
    return fallback;
  }
  return value;
}

async function main(): Promise<void> {
  const bridge = new Bridge({
    port: intFromEnv('TROUBLEMAKER_PORT', 8765),
    livePort: intFromEnv('TROUBLEMAKER_LIVE_PORT', 9877),
    logger,
  });

  await bridge.start();
  logger.info('waiting for Ableton Live (Preferences > Link/Tempo/MIDI > TroubleMaker)');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received; shutting down`);
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.info(`failed to start: ${String(error)}`);
  process.exit(1);
});
