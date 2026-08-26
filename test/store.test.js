import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/local-storage.js';

const { allCards, saveCard, saveCards, removeCard, clearCards, loadPinned, savePinned } =
  await import('../js/store.js');

beforeEach(() => localStorage.clear());

const card = (id, name = `${id}.md`) => ({ id, name, tags: [], md: 'corpo' });

test('saveCard persiste e allCards devolve', () => {
  saveCard(card('1'));
  assert.deepEqual(allCards(), [card('1')]);
});

test('saveCard com mesmo id substitui', () => {
  saveCard(card('1', 'antes.md'));
  saveCard(card('1', 'depois.md'));
  assert.deepEqual(allCards().map(c => c.name), ['depois.md']);
});

test('saveCards grava em lote', () => {
  saveCards([card('1'), card('2'), card('3')]);
  assert.equal(allCards().length, 3);
});

test('removeCard apaga só o card indicado', () => {
  saveCards([card('1'), card('2')]);
  removeCard('1');
  assert.deepEqual(allCards().map(c => c.id), ['2']);
});

test('clearCards esvazia o store', () => {
  saveCards([card('1'), card('2')]);
  clearCards();
  assert.deepEqual(allCards(), []);
});

test('pinned faz ida e volta', () => {
  savePinned(new Set(['a', 'b']));
  assert.deepEqual(loadPinned(), ['a', 'b']);
});

test('store vazio devolve listas vazias', () => {
  assert.deepEqual(allCards(), []);
  assert.deepEqual(loadPinned(), []);
});
