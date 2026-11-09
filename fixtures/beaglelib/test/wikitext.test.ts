import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDay, hidePlaces } from '../src/wikitext.ts';

const day = `*[[Russian invasion of Ukraine]]
**A drone strike on [[Kharkiv]] kills four people and injures twelve, according to the regional governor. [https://example.com (BBC)]
** Short line.
**Floods in [[Mannheim|the city of Mannheim]] force '''hundreds''' of people from their homes.<ref>x</ref>
*[[Talk]] about nothing much at all, without an ending`;
test('a bullet that is only a link is a heading, not an item', () => assert.ok(!parseDay(day).some(i => i.text === 'Russian invasion of Ukraine')));
test('items read as sentences', () => assert.equal(parseDay(day).length, 2));
test('a short line is not an item', () => assert.ok(!parseDay(day).some(i => i.text.startsWith('Short'))));
test('a line with no closing stop is not an item', () => assert.ok(!parseDay(day).some(i => i.text.includes('without an ending'))));
test('citations are removed', () => assert.ok(!parseDay(day)[0].text.includes('http')));
test('links become their labels', () => assert.ok(parseDay(day)[1].text.includes('the city of Mannheim')));
test('bold marks are removed', () => assert.ok(parseDay(day)[1].text.includes(' hundreds ')));
test('ref tags are removed', () => assert.ok(!parseDay(day)[1].text.includes('ref')));
test('an item keeps its link targets', () => assert.deepEqual(parseDay(day)[0].links, ['Kharkiv']));
test('an item keeps each link\'s label', () => assert.deepEqual(parseDay(day)[1].labels, [{ target: 'Mannheim', label: 'the city of Mannheim' }]));
test('lines that are not bullets are ignored', () => assert.equal(parseDay('Some prose that is long enough to be a sentence on its own.').length, 0));
const item = { text: 'Bushfires spread across New South Wales and Wales, near Sydney.', links: [], labels: [{ target: 'New South Wales', label: 'New South Wales' }, { target: 'Wales', label: 'Wales' }, { target: 'Sydney', label: 'Sydney' }] };
test('hidePlaces hides the places it is given', () => assert.equal(hidePlaces(item, new Set(['Sydney'])), 'Bushfires spread across New South Wales and Wales, near [place].'));
test('hidePlaces hides a longer name whole before a shorter one inside it', () => assert.equal(hidePlaces(item, new Set(['New South Wales', 'Wales'])), 'Bushfires spread across [place] and [place], near Sydney.'));
test('hidePlaces leaves places it is not given', () => assert.equal(hidePlaces(item, new Set()), item.text));
test('hidePlaces does not hide part of a word', () => assert.equal(hidePlaces({ text: 'Romania and Roma met.', links: [], labels: [{ target: 'Rome', label: 'Roma' }] }, new Set(['Rome'])), 'Romania and [place] met.'));
test('hidePlaces hides every mention', () => assert.equal(hidePlaces({ text: 'Paris, then Paris again.', links: [], labels: [{ target: 'Paris', label: 'Paris' }] }, new Set(['Paris'])), '[place], then [place] again.'));
