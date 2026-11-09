import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeReceipt, digits, similar, truthOf, textOf } from '../src/arenas/receipts/grade.ts';

const truth = { items: [{ name: 'REAL GANACHE', count: '1', price: '16,500' }, { name: 'EGG TART', count: '1', price: '13,000' }, { name: 'PIZZA TOAST', count: '1', price: '16,000' }], total: '45,500', cash: '50,000', change: '4,500', subtotal: null, tax: null };

test('numbers are compared by their digits, whatever the separators', () => {
  assert.equal(digits('45,500'), '45500'); assert.equal(digits('45.500'), '45500'); assert.equal(digits('Rp 45 500'), '45500'); assert.equal(digits('0045,500'), '45500');
  assert.equal(digits(null), '');
});

test('names are compared fuzzily: case, spacing and a typo or two do not matter', () => {
  assert.ok(similar('REAL GANACHE', 'Real Ganache') === 1);
  assert.ok(similar('PIZZA TOAST', 'PIZA TOAST') >= .8);
  assert.ok(similar('EGG TART', 'BEEF BURGER') < .5);
});

test('a perfect reading scores 1', () => {
  assert.equal(gradeReceipt(truth, truth), 1);
});

test('only the fields the receipt has are scored, and the total weighs most', () => {
  const noTotal = { ...truth, total: '45,000' };
  const noChange = { ...truth, change: '4,000' };
  assert.ok(gradeReceipt(noTotal, truth) < gradeReceipt(noChange, truth), 'a wrong total costs more than a wrong change');
  assert.equal(gradeReceipt({ ...truth, subtotal: '1', tax: '2' }, truth), 1, 'fields the receipt does not have are not scored');
});

test('items are matched one to one by name and price, so listing one twice does not help', () => {
  const twice = { ...truth, items: [truth.items[0], truth.items[0], truth.items[0]] };
  assert.ok(gradeReceipt(twice, truth) < gradeReceipt({ ...truth, items: [truth.items[0]] }, truth) + 1e-9);
  const wrongPrice = { ...truth, items: truth.items.map((x, i) => i ? x : { ...x, price: '1' }) };
  assert.ok(gradeReceipt(wrongPrice, truth) < 1);
});

test('a malformed answer scores 0 rather than throwing', () => {
  assert.equal(gradeReceipt(null, truth), 0);
  assert.equal(gradeReceipt({ items: 'lots' }, truth), 0);
});

test('CORD ground truth becomes a truth, and its words become the receipt\'s lines, top to bottom, left to right', () => {
  const gt = {
    gt_parse: { menu: { nm: 'TEA', cnt: '2', price: '10,000' }, sub_total: { subtotal_price: '10,000', tax_price: '1,000' }, total: { total_price: '11,000' } },
    valid_line: [
      { words: [{ text: '11,000', row_id: 3, quad: { x1: 300, y1: 200 } }, { text: 'TOTAL', row_id: 3, quad: { x1: 10, y1: 201 } }], category: 'total.total_price' },
      { words: [{ text: 'TEA', row_id: 1, quad: { x1: 10, y1: 100 } }, { text: '2', row_id: 1, quad: { x1: 200, y1: 100 } }, { text: '10,000', row_id: 1, quad: { x1: 300, y1: 100 } }], category: 'menu.nm' },
    ],
  };
  assert.deepEqual(truthOf(gt), { items: [{ name: 'TEA', count: '2', price: '10,000' }], subtotal: '10,000', tax: '1,000', total: '11,000', cash: null, change: null });
  assert.equal(textOf(gt), 'TEA 2 10,000\nTOTAL 11,000');
});
