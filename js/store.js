const KEY = 'flashcards';
const PINNED_KEY = 'flashcards.pinned';

export function allCards() {
  return Object.values(read());
}

export function saveCard(card) {
  saveCards([card]);
}

export function saveCards(list) {
  const cards = read();
  for (const card of list) cards[card.id] = card;
  write(cards);
}

export function removeCard(id) {
  const cards = read();
  delete cards[id];
  write(cards);
}

function read() {
  return JSON.parse(localStorage.getItem(KEY) ?? '{}');
}

function write(cards) {
  localStorage.setItem(KEY, JSON.stringify(cards));
}

export function loadPinned() {
  return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]');
}

export function savePinned(ids) {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...ids]));
}
