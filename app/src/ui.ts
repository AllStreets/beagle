// Small helpers every room shares: escaping, money and time in words, and terms of art.
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const money = (x: number) => `$${x.toFixed(x < 1 ? 3 : 2)}`;
export const secs = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
export const dist = (d: number | null) => d === null ? 'no answer' : d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString()} km`;
// terms of art, each with its meaning in plain words, shown on hover and to screen readers
export const TERMS: Record<string, string> = {
  agent: 'A design for doing the task: what it is told, which model runs it, which tools it may use, and how its steps are wired.',
  genome: 'An agent written down as data, so it can be compared, changed and bred.',
  control: 'A simple method every agent has to beat for its score to mean anything.',
  interval: 'The range the true score most likely lies in, given how few items have been tried. When two ranges overlap, neither agent is clearly better.',
  front: 'The Pareto front: agents nobody beats on accuracy without costing more or taking longer.',
  sealed: 'Items set aside before the voyage began and never shown to anyone, used once at the end to check the winners honestly.',
  fossil: 'A small network trained on this Mac on a winning agent\'s answers, so the skill runs in milliseconds for free.',
};
export const term = (k: keyof typeof TERMS, label = k) => `<dfn tabindex="0" title="${esc(TERMS[k])}">${label}<span role="tooltip">${esc(TERMS[k])}</span></dfn>`;

export const head = (title: string, sub: string) => `<header class="folio-head"><h1>${title}</h1><p>${sub}</p></header>`;
