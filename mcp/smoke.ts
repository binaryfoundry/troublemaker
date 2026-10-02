/**
 * Read-only smoke test of the MCP server against a running Live: spawns the
 * server over stdio exactly as an MCP client would and calls tools that do
 * not change the Set.
 *
 *   npm run test:mcp
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'troublemaker-smoke', version: '0' });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'mcp/server.ts'], stderr: 'inherit' }),
);

function body(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text: string }>).map((c) => c.text).join('\n');
}

let failures = 0;
async function check(name: string, args: Record<string, unknown>, show: (text: string) => string): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  const text = body(result);
  if (result.isError) failures += 1;
  process.stdout.write(`${result.isError ? 'FAIL' : 'ok  '} ${name.padEnd(14)} ${result.isError ? text : show(text)}\n`);
}

const { tools } = await client.listTools();
const { prompts } = await client.listPrompts();
process.stdout.write(`${tools.length} tools, ${prompts.length} prompts\n`);

await check('live_status', {}, (t) => {
  const s = JSON.parse(t) as { capabilities: { live_version?: string }; transport: { playing: boolean } };
  return `Live ${s.capabilities.live_version ?? '?'}, playing=${s.transport.playing}`;
});
await check('get_project', {}, (t) => {
  const p = JSON.parse(t) as { tracks?: unknown[]; scenes?: unknown[] };
  return `${p.tracks?.length ?? 0} tracks, ${p.scenes?.length ?? 0} scenes`;
});
await check('get_selection', {}, (t) => `${t.length} bytes`);
await check('master_chain', { action: 'inspect' }, (t) => {
  const c = JSON.parse(t) as { readings: unknown[]; limiter_true_peak: string };
  return `${c.readings.length} roles read, true peak ${c.limiter_true_peak}`;
});
await check('effects', { query: 'roulette wheel slowing down' }, (t) => (JSON.parse(t) as { id: string }).id);
await check('arrangement', { action: 'plan', style: 'melodic_techno' }, (t) => t.split('\n').at(-1)!.trim());
await check('references', { action: 'pick', reference_set: 'melodic techno' }, (t) => t.split('\n')[0]!);

await client.close();
process.exit(failures ? 1 : 0);
