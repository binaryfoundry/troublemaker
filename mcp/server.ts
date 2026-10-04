#!/usr/bin/env node
/**
 * TroubleMaker MCP server, over stdio.
 *
 * If a bridge is already running (npm run bridge), commands go to it over
 * HTTP, so the MCP client, the CLI and anything else share one connection to
 * Live and one set of snapshots. Otherwise the bridge runs in this process.
 *
 * stdout carries the MCP protocol; every log line goes to stderr.
 *
 * Environment:
 *   TROUBLEMAKER_PORT       bridge HTTP port          (default 8765)
 *   TROUBLEMAKER_LIVE_PORT  Remote Script TCP port    (default 9877)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { BridgeError } from '../bridge/src/errors.js';
import { postJson } from '../bridge/src/http-post.js';
import { Logger } from '../bridge/src/logger.js';
import { Bridge } from '../bridge/src/server.js';
import { createMcpServer, type McpClient } from './tools.js';

const port = Number(process.env.TROUBLEMAKER_PORT ?? 8765);
const livePort = Number(process.env.TROUBLEMAKER_LIVE_PORT ?? 9877);
const base = `http://127.0.0.1:${port}`;

function log(message: string): void {
  process.stderr.write(`[troublemaker-mcp] ${message}\n`);
}

/** A client for a bridge that is already running. */
function httpClient(): McpClient {
  return {
    async post(command, args = {}, options = {}) {
      const body = (await postJson(`${base}/command`, {
        command,
        args,
        dry_run: options.dryRun === true,
      })) as {
        ok: boolean;
        result?: unknown;
        error?: { code: string; message: string; [key: string]: unknown };
      };
      if (!body.ok) {
        const { code, message, ...details } = body.error ?? { code: 'BRIDGE_ERROR', message: 'Unknown error' };
        throw new BridgeError(code, message, details);
      }
      return body.result;
    },
  };
}

async function bridgeIsRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let client: McpClient;
  let bridge: Bridge | null = null;
  if (await bridgeIsRunning()) {
    log(`using the bridge at ${base}`);
    client = httpClient();
  } else {
    bridge = new Bridge({ port, livePort, logger: new Logger('silent') });
    try {
      // Serve HTTP too, so the CLI can share this bridge while it runs.
      await bridge.start();
      log(`started a bridge on ${base}`);
    } catch {
      bridge.transport.start();
      log('started an in-process bridge (HTTP port busy)');
    }
    const local = bridge;
    client = { post: (command, args = {}, options = {}) => local.execute(command, args, options) };
  }

  const server = createMcpServer(client);
  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    await server.close();
    if (bridge) await bridge.stop().catch(() => undefined);
    process.exit(0);
  };
  process.stdin.on('close', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  log(`failed to start: ${String(error)}`);
  process.exit(1);
});
