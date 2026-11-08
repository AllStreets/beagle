// Wikipedia's Current Events pages are wikitext. An item is a bullet line that reads as a
// sentence; a bullet that is only a link is a topic heading for the items under it.
export type Item = { text: string; links: string[]; labels: { target: string; label: string }[] };

export function parseDay(wikitext: string): Item[] {
  const items: Item[] = [];
  for (const raw of wikitext.split('\n')) {
    if (!raw.startsWith('*')) continue;
    const line = raw.replace(/^\*+/, '').trim();
    const found = [...line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)];
    const links = found.map(m => m[1].trim());
    const labels = found.map(m => ({ target: m[1].trim(), label: (m[2] ?? m[1]).replace(/'{2,}/g, '').trim() }));
    const text = line
      .replace(/\[https?:[^\]]*\]/g, '')                 // citations: [https://... (Source)]
      .replace(/\{\{[^}]*\}\}/g, '')                     // templates
      .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')  // [[Target|label]] -> label
      .replace(/'{2,}/g, '')                             // bold and italics
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ').trim();
    if (text.length < 30 || !/[.!?"”)]$/.test(text)) continue;
    items.push({ text, links: [...new Set(links)], labels });
  }
  return items;
}

// The same item with every named place replaced by [place], so it has to be placed from context.
// Longer labels go first, so "New South Wales" is hidden whole before "Wales" could be.
export function hidePlaces(item: Item, places: Set<string>): string {
  const labels = [...new Set(item.labels.filter(l => places.has(l.target)).map(l => l.label))].filter(Boolean).sort((a, b) => b.length - a.length);
  let text = item.text;
  for (const l of labels) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu'), '[place]');
  return text;
}
