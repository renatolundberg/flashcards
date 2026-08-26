import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, serializeCard } from '../js/card-format.js';

test('parseCard separa corpo e linha final de hashtags', () => {
  const card = parseCard('a.md', 'Linha 1\nLinha 2\n\n#Tag1 #tag2 #tag1\n');
  assert.equal(card.name, 'a.md');
  assert.equal(card.md, 'Linha 1\nLinha 2');
  assert.deepEqual(card.tags, ['tag1', 'tag2']);
  assert.ok(card.id);
});

test('parseCard sem linha de tags devolve corpo inteiro e tags vazias', () => {
  const card = parseCard('a.md', 'Só corpo\ncom #hashtag no meio');
  assert.equal(card.md, 'Só corpo\ncom #hashtag no meio');
  assert.deepEqual(card.tags, []);
});

test('parseCard reaproveita o id recebido', () => {
  assert.equal(parseCard('a.md', 'x', 'id-1').id, 'id-1');
});

test('parseCard gera ids distintos quando não recebe id', () => {
  assert.notEqual(parseCard('a.md', 'x').id, parseCard('a.md', 'x').id);
});

test('serializeCard e parseCard são inversos', () => {
  const card = parseCard('a.md', 'Corpo\n\n#a #b');
  const again = parseCard('a.md', serializeCard(card), card.id);
  assert.deepEqual(again, card);
});
