// Wikipedia's Current Events pages are wikitext. An item is a bullet line that reads as a
// sentence; a bullet that is only a link is a topic heading for the items under it.
export type Item = { text: string; links: string[] };

export function parseDay(wikitext: string): Item[] {
  const items: Item[] = [];
  for (const raw of wikitext.split('\n')) {
    if (!raw.startsWith('*')) continue;
    const line = raw.replace(/^\*+/, '').trim();
    const links = [...line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(m => m[1].trim());
    const text = line
      .replace(/\[https?:[^\]]*\]/g, '')                 // citations: [https://... (Source)]
      .replace(/\{\{[^}]*\}\}/g, '')                     // templates
      .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')  // [[Target|label]] -> label
      .replace(/'{2,}/g, '')                             // bold and italics
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ').trim();
    if (text.length < 30 || !/[.!?"”)]$/.test(text)) continue;
    items.push({ text, links: [...new Set(links)] });
  }
  return items;
}
