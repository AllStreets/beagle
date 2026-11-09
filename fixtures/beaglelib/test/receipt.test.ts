import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeReceipt, digits, similar, truthOf, textOf } from '../src/receipt.ts';

const truth = { items: [{ name: 'REAL GANACHE', count: '1', price: '16,500' }, { name: 'EGG TART', count: '1', price: '13,000' }, { name: 'PIZZA TOAST', count: '1', price: '16,000' }], total: '45,500', cash: '50,000', change: '4,500', subtotal: null, tax: null };
test('digits drops separators', () => assert.equal(digits('45,500'), '45500'));
test('digits drops dots', () => assert.equal(digits('45.500'), '45500'));
test('digits drops currency and spaces', () => assert.equal(digits('Rp 45 500'), '45500'));
test('digits drops leading zeros', () => assert.equal(digits('0045,500'), '45500'));
test('digits keeps a lone zero', () => assert.equal(digits('0'), '0'));
test('digits of nothing is empty', () => assert.equal(digits(null), ''));
test('similar: same words are 1', () => assert.equal(similar('EGG TART', 'EGG TART'), 1));
test('similar ignores case', () => assert.equal(similar('Real Ganache', 'REAL GANACHE'), 1));
test('similar ignores punctuation and spacing', () => assert.equal(similar('egg-tart!', 'EGG  TART'), 1));
test('similar forgives one typo', () => assert.ok(similar('PIZZA TOAST', 'PIZA TOAST') >= .8));
test('similar: different things are far apart', () => assert.ok(similar('EGG TART', 'BEEF BURGER') < .5));
test('similar of an empty name to a name is 0', () => assert.equal(similar('', 'TEA'), 0));
test('similar of two empty names is 1', () => assert.equal(similar('', ''), 1));
test('a perfect reading scores 1', () => assert.equal(gradeReceipt(truth, truth), 1));
test('a wrong total costs more than a wrong change', () => assert.ok(gradeReceipt({ ...truth, total: '1' }, truth) < gradeReceipt({ ...truth, change: '1' }, truth)));
test('fields the receipt lacks are not scored', () => assert.equal(gradeReceipt({ ...truth, subtotal: '1', tax: '2' }, truth), 1));
test('a wrong total alone scores 1 minus its share', () => assert.ok(Math.abs(gradeReceipt({ ...truth, total: '1' }, truth) - (1 - .3 / .8)) < 1e-9));
test('listing an item three times does not help', () => assert.ok(gradeReceipt({ ...truth, items: [truth.items[0], truth.items[0], truth.items[0]] }, truth) <= gradeReceipt({ ...truth, items: [truth.items[0]] }, truth) + 1e-9));
test('an item with the wrong price does not count', () => assert.ok(gradeReceipt({ ...truth, items: truth.items.map((x, i) => i ? x : { ...x, price: '1' }) }, truth) < 1));
test('items in another order still count', () => assert.equal(gradeReceipt({ ...truth, items: [...truth.items].reverse() }, truth), 1));
test('no items listed scores no item credit', () => assert.ok(Math.abs(gradeReceipt({ ...truth, items: [] }, truth) - .4 / .8) < 1e-9));
test('a malformed answer scores 0', () => { assert.equal(gradeReceipt(null, truth), 0); assert.equal(gradeReceipt({ items: 'lots' }, truth), 0); });
test('a receipt with nothing to grade scores 0', () => assert.equal(gradeReceipt(truth, { items: [], total: null, subtotal: null, tax: null, cash: null, change: null }), 0));
const gt = {
  gt_parse: { menu: { nm: 'TEA', cnt: '2', price: '10,000' }, sub_total: { subtotal_price: '10,000', tax_price: '1,000' }, total: { total_price: '11,000' } },
  valid_line: [
    { words: [{ text: '11,000', row_id: 3, quad: { x1: 300, y1: 200 } }, { text: 'TOTAL', row_id: 3, quad: { x1: 10, y1: 201 } }], category: 'total.total_price' },
    { words: [{ text: 'TEA', row_id: 1, quad: { x1: 10, y1: 100 } }, { text: '2', row_id: 1, quad: { x1: 200, y1: 100 } }, { text: '10,000', row_id: 1, quad: { x1: 300, y1: 100 } }], category: 'menu.nm' },
  ],
};
test('truthOf reads a single menu item', () => assert.deepEqual(truthOf(gt).items, [{ name: 'TEA', count: '2', price: '10,000' }]));
test('truthOf reads the totals', () => { const t = truthOf(gt); assert.equal(t.total, '11,000'); assert.equal(t.subtotal, '10,000'); assert.equal(t.tax, '1,000'); });
test('truthOf leaves missing fields null', () => { const t = truthOf(gt); assert.equal(t.cash, null); assert.equal(t.change, null); });
test('truthOf reads a list of menu items', () => assert.equal(truthOf({ ...gt, gt_parse: { menu: [{ nm: 'A', price: '1' }, { nm: 'B', price: '2' }] } }).items.length, 2));
test('truthOf skips a menu entry with no name', () => assert.equal(truthOf({ ...gt, gt_parse: { menu: [{ price: '1' }, { nm: 'B', price: '2' }] } }).items.length, 1));
test('textOf puts rows top to bottom', () => assert.equal(textOf(gt).split('\n')[0], 'TEA 2 10,000'));
test('textOf puts words left to right', () => assert.equal(textOf(gt).split('\n')[1], 'TOTAL 11,000'));
