import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { LimitError, type Turn } from './index.ts';

// Claude through the person's own Claude Code, headless. Settings, plugins, MCP servers and
// tools are left out (an MCP tool list alone can be tens of thousands of tokens), nothing is
// saved as a session, and the whole conversation so far travels as one message: Beagle runs
// its own tool loop, so Claude only ever answers one turn.
const LIMIT = /usage limit|rate limit|limit reached|too many requests|\b429\b|overloaded/i;

export function claude(name: string, turns: Turn[], o: { schema?: object; timeoutMs?: number }): Promise<{ text: string; usd: number; ms: number }> {
  const system = turns.filter(t => t.role === 'system').map(t => t.content).join('\n\n');
  const convo = turns.filter(t => t.role !== 'system');
  const content = convo.length === 1 ? convo[0].content
    : convo.map(t => `<${t.role === 'user' ? 'turn from Beagle' : 'your earlier turn'}>\n${t.content}\n</${t.role === 'user' ? 'turn from Beagle' : 'your earlier turn'}>`).join('\n\n');
  const args = ['-p', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--tools', '',
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', name];
  if (system) args.push('--system-prompt', system);
  if (o.schema) args.push('--json-schema', JSON.stringify(o.schema));
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('claude timed out')); }, o.timeoutMs ?? 300_000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => {
      clearTimeout(timer);
      const last = out.trim().split('\n').reverse().find(l => l.includes('"type":"result"'));
      let d: any; try { d = JSON.parse(last ?? ''); } catch { /* handled below */ }
      if (!d) return reject(LIMIT.test(err + out) ? new LimitError((err || out).slice(-300)) : new Error(`claude exited ${code}: ${(err || out).slice(-300)}`));
      if (d.is_error) return reject(LIMIT.test(String(d.result)) ? new LimitError(String(d.result)) : new Error(String(d.result ?? 'claude error')));
      const text = o.schema && d.structured_output !== undefined ? JSON.stringify(d.structured_output) : String(d.result ?? '');
      resolve({ text, usd: d.total_cost_usd ?? 0, ms: Date.now() - t0 });
    });
    p.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: content }] } }) + '\n');
  });
}
