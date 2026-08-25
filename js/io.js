/* global JSZip */

import { parseCard, serializeCard } from './card-format.js';

export async function importFiles(fileList) {
  const cards = [];
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) cards.push(...await readZip(file));
    else if (/\.md$/i.test(file.name)) cards.push(parseCard(file.name, await file.text()));
  }
  return cards;
}

async function readZip(zipFile) {
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
  const entries = Object.values(zip.files).filter(f => !f.dir && /\.md$/i.test(f.name));
  return Promise.all(entries.map(async f => parseCard(f.name.split('/').pop(), await f.async('string'))));
}

export function exportCard(card) {
  saveAs(`${stem(card.name)}.md`, new Blob([serializeCard(card)], { type: 'text/markdown' }));
}

export async function exportZip(cards) {
  const zip = new JSZip();
  const used = new Set();
  for (const card of cards) zip.file(uniqueName(`${stem(card.name) || 'card'}.md`, used), serializeCard(card));
  saveAs('flashcards.zip', await zip.generateAsync({ type: 'blob' }));
}

const stem = name => name.replace(/\.md$/i, '');

function uniqueName(name, used) {
  if (!used.has(name)) { used.add(name); return name }
  let n = 2;
  while (used.has(`${stem(name)}-${n}.md`)) n++;
  return `${stem(name)}-${n}.md`;
}

function saveAs(filename, blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
