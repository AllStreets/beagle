// Tools any arena may ask for by name in its arena.json. The calculator parses arithmetic itself,
// with no eval: numbers, + - * / and mod, brackets, and floor, ceil, round, abs, min, max.
import type { ToolSpec } from './types.ts';

const FN: Record<string, (...xs: number[]) => number> = { floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, min: Math.min, max: Math.max };

export function calculate(expr: string): number {
  const toks = String(expr).match(/\d+(?:\.\d+)?|[a-z]+|[-+*/%(),]|\S/gi) ?? [];
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const fail = (): never => { throw new Error('only numbers, + - * / mod, brackets, and floor, ceil, round, abs, min, max'); };
  const atom = (): number => {
    const t = next(); if (t === undefined) return fail();
    if (/^\d/.test(t)) return Number(t);
    if (t === '-') return -atom();
    if (t === '(') { const v = sum(); if (next() !== ')') fail(); return v; }
    const f = FN[t.toLowerCase()]; if (!f || next() !== '(') return fail();
    const args = [sum()]; while (peek() === ',') { next(); args.push(sum()); }
    if (next() !== ')') fail(); return f(...args);
  };
  const prod = (): number => { let v = atom(); for (;;) { const t = peek(); if (t === '*') { next(); v *= atom(); } else if (t === '/') { next(); v /= atom(); } else if (t === '%' || t?.toLowerCase() === 'mod') { next(); const m = atom(); v = ((v % m) + m) % m; } else return v; } };
  const sum = (): number => { let v = prod(); for (;;) { const t = peek(); if (t === '+') { next(); v += prod(); } else if (t === '-') { next(); v -= prod(); } else return v; } };
  const v = sum(); if (i !== toks.length || !isFinite(v)) fail();
  return v;
}

export const BUILTIN: Record<string, ToolSpec> = {
  calculate: {
    name: 'calculate',
    describe: 'Work out an arithmetic expression exactly: numbers, + - * /, mod (always 0 or more), brackets, and floor, ceil, round, abs, min, max. Use it for every sum rather than doing it in your head.',
    args: { type: 'object', required: ['expression'], properties: { expression: { type: 'string' } } },
    run: (a: { expression?: string }) => { try { return { result: calculate(a?.expression ?? '') }; } catch (e) { return { error: (e as Error).message }; } },
  },
};
