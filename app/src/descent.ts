// What the designer changed: a child set beside the parent it was bred from, its design as a
// list of differences and its instructions as a word-by-word diff, with the reason the designer
// gave. Crossings show each parent in turn.
import { api, type Genome } from './data.ts';
import { esc } from './ui.ts';
import type { Ctx } from './rooms.ts';

type Node = { id: string; name: string; generation: number; parents: string[]; kept: boolean; reason: string | null; mean: number | null; genome: Genome | null };

// the longest common subsequence of sentences, marked as kept, struck out or written in: a rewrite
// reads like an editor's marks, not a shower of word fragments
const sentences = (s: string) => s.split(/(?<=[.?!:])\s+/).filter(Boolean);
export function wordDiff(a: string, b: string): { t: 'same' | 'del' | 'ins'; w: string }[] {
  const A = sentences(a), B = sentences(b), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: 'same' | 'del' | 'ins'; w: string }[] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push({ t: 'same', w: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: 'del', w: A[i++] }); else out.push({ t: 'ins', w: B[j++] }); }
  while (i < n) out.push({ t: 'del', w: A[i++] }); while (j < m) out.push({ t: 'ins', w: B[j++] });
  return out;
}

const shape = (g: Genome) => ({ single: 'answers in one go', 'plan-then-answer': 'plans first', 'self-check': 'checks its own answer', vote: `votes ${g.workflow.n ?? 3} times` } as Record<string, string>)[g.workflow.shape] ?? g.workflow.shape;
function traits(p: Genome, c: Genome) {
  const rows: [string, string, string][] = [];
  if (p.model !== c.model) rows.push(['Model', p.model.replace(/^\w+:/, ''), c.model.replace(/^\w+:/, '')]);
  if (p.workflow.shape !== c.workflow.shape || p.workflow.n !== c.workflow.n) rows.push(['Steps', shape(p), shape(c)]);
  if (p.tools.join() !== c.tools.join()) rows.push(['Gazetteer', p.tools.length ? 'may look places up' : 'none', c.tools.length ? 'may look places up' : 'none']);
  if (p.memory.examples !== c.memory.examples) rows.push(['Worked examples', String(p.memory.examples), String(c.memory.examples)]);
  return rows;
}

export async function descent(c: Ctx, genomeId: string): Promise<string> {
  const me = c.gen.genomes.find(g => g.id === genomeId);
  if (!me || !me.parents.length || c.genN === 0) return '';
  const nodes = await api<Node[]>(`/voyages/${c.voyage.id}/lineage`, []);
  const score = (id: string, gen: number) => nodes.find(n => n.id === id && n.generation === gen)?.mean;
  const kept = me.parents.length === 1 && me.parents[0] === me.id;
  if (kept) return `<h3>Its descent</h3><p class="soft">Kept unchanged from generation ${c.genN}, where it scored ${Math.round((score(me.id, c.genN - 1) ?? 0) * 100)}. Its design is the same; any change in score is the noise of a new race.</p>`;
  const parts = me.parents.map(pid => nodes.find(n => n.id === pid && n.generation === c.genN - 1)).filter((n): n is Node => !!n?.genome);
  return `<h3>What the designer changed</h3>
    ${me.reason ? `<blockquote class="reason">${esc(me.reason)}</blockquote>` : ''}
    ${parts.map(p => {
      const t = traits(p.genome!, me.genome), d = wordDiff(p.genome!.instructions, me.genome.instructions);
      const added = d.filter(x => x.t === 'ins' && x.w.trim()).length, removed = d.filter(x => x.t === 'del' && x.w.trim()).length;
      return `<div class="descent">
        <p class="from">From <b>${esc(p.name)}</b>${p.mean !== null ? `, which scored ${Math.round(p.mean * 100)}` : ''}${me.parents.length > 1 ? ' (one of two parents)' : ''}.</p>
        ${t.length ? `<table class="traits"><thead><tr><th></th><th>Parent</th><th>Child</th></tr></thead><tbody>${t.map(([k, a, b]) => `<tr><th>${k}</th><td><del>${esc(a)}</del></td><td><ins>${esc(b)}</ins></td></tr>`).join('')}</tbody></table>` : '<p class="soft">The same model, steps, tools and examples.</p>'}
        <p class="soft">Its instructions: ${added} sentence${added === 1 ? '' : 's'} written in, ${removed} struck out, ${d.filter(x => x.t === 'same').length} kept.</p>
        <div class="diff">${d.map(x => `<p class="${x.t}">${x.t === 'del' ? `<del>${esc(x.w)}</del>` : x.t === 'ins' ? `<ins>${esc(x.w)}</ins>` : esc(x.w)}</p>`).join('')}</div>
      </div>`;
    }).join('')}`;
}
