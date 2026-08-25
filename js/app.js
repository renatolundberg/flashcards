import { allCards, saveCard, removeCard, clearCards, loadPinned, savePinned } from './store.js';
import { parseCard, serializeCard } from './card-format.js';
import { importFiles, exportCard, exportZip } from './io.js';
import {
  parseFolderLink, connect, listMarkdown, readFile, fileModifiedTime, writeFile, createFile, hashText,
} from './drive.js';
import { DRIVE_CLIENT_ID } from './config.js';

const MODE_KEY = 'flashcards.mode';

const state = {
  selectedTags: new Set(),
  editingId: null,
  pinned: new Set(loadPinned()),
  mode: localStorage.getItem(MODE_KEY) ?? 'edit',
  studyCardId: null,
  studyRevealed: false,
};

const ICONS = {
  pin: '<svg viewBox="0 0 24 24"><path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
};

const $ = selector => document.querySelector(selector);

$('#mode-edit').onclick = () => setMode('edit');
$('#mode-view').onclick = () => setMode('view');
$('#mode-study').onclick = () => setMode('study');

function setMode(mode) {
  state.mode = mode;
  state.editingId = null;
  if (mode === 'study') {
    state.studyCardId = null;
    state.studyRevealed = false;
  }
  localStorage.setItem(MODE_KEY, mode);
  refresh();
}

$('#import').onclick = () => $('#file-input').click();

$('#drive').onclick = openDriveDialog;

$('#file-input').onchange = async ({ target }) => {
  for (const card of await importFiles(target.files)) saveCard(card);
  target.value = '';
  refresh();
};

$('#new-card').onclick = () => {
  state.editingId = 'new';
  refresh();
};

$('#export-zip').onclick = () => exportZip(visibleCards());

$('#clear').onclick = () => {
  const count = allCards().length;
  if (!count || !confirm(`Delete all ${count} cards?`)) return;
  clearCards();
  state.pinned.clear();
  savePinned(state.pinned);
  refresh();
};

function togglePin(id) {
  if (state.pinned.has(id)) state.pinned.delete(id);
  else state.pinned.add(id);
  savePinned(state.pinned);
  refresh();
}

function refresh() {
  document.body.classList.toggle('view-mode', state.mode === 'view');
  document.body.classList.toggle('study-mode', state.mode === 'study');
  $('#mode-edit').classList.toggle('on', state.mode === 'edit');
  $('#mode-view').classList.toggle('on', state.mode === 'view');
  $('#mode-study').classList.toggle('on', state.mode === 'study');
  renderTagBar();
  renderCards();
  renderPinned();
}

function visibleCards() {
  return allCards()
    .filter(card => [...state.selectedTags].every(tag => card.tags.includes(tag)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function countBy(tagsOf) {
  const counts = new Map();
  for (const tag of tagsOf())
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function* allTags() {
  for (const { tags } of allCards()) yield* tags;
}

function renderTagBar() {
  const nav = $('#tags');
  nav.textContent = '';
  const globalCounts = new Map(countBy(allTags));

  for (const tag of state.selectedTags) {
    const chip = makeChip(tag, globalCounts.get(tag) ?? 0);
    chip.classList.add('on');
    nav.append(chip);
  }
  if (state.selectedTags.size) nav.append(document.createElement('hr'));

  const related = countBy(relatedTags);
  if (!related.size && state.selectedTags.size) {
    nav.append(hint(visibleCards().length
      ? 'No further hashtags.'
      : 'No cards match this combination.'));
  }
  for (const [tag, count] of related) nav.append(makeChip(tag, count));
}

function hint(text) {
  const p = document.createElement('p');
  p.className = 'muted hint';
  p.textContent = text;
  return p;
}

function* relatedTags() {
  for (const card of visibleCards())
    for (const tag of card.tags)
      if (!state.selectedTags.has(tag)) yield tag;
}

function makeChip(tag, count) {
  const chip = document.createElement('button');
  chip.className = 'tag';
  chip.textContent = `#${tag} ${count}`;
  chip.onclick = () => toggleTag(tag);
  return chip;
}

function toggleTag(tag) {
  if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
  else state.selectedTags.add(tag);
  if (state.mode === 'study') {
    state.studyCardId = null;
    state.studyRevealed = false;
  }
  refresh();
}

function renderCards() {
  const pane = $('#cards');
  pane.textContent = '';

  if (state.editingId) return pane.append(editorForm());
  if (state.mode === 'study') return renderStudy(pane);

  const cards = visibleCards();
  $('#count').textContent = `${cards.length} card${cards.length === 1 ? '' : 's'}`;

  if (!cards.length) {
    pane.append(hint(allCards().length
      ? 'No cards match the selected hashtags.'
      : 'No cards yet — use Import to load .md files or a .zip.'));
    return;
  }
  for (const [i, card] of cards.entries()) {
    if (i) pane.append(document.createElement('hr'));
    pane.append(cardArticle(card, false));
  }
}

function renderPinned() {
  const pane = $('#pinned');
  pane.textContent = '';
  if (state.mode === 'study') return;

  const byId = new Map(allCards().map(card => [card.id, card]));
  const pinnedCards = [...state.pinned].map(id => byId.get(id)).filter(Boolean);

  if (!pinnedCards.length) {
    pane.append(hint(state.mode === 'view'
      ? 'Nothing pinned yet — tap a card to pin it here while you browse.'
      : 'Nothing pinned yet — use the pin on a card to keep it here while you browse.'));
    return;
  }
  for (const [i, card] of pinnedCards.entries()) {
    if (i) pane.append(document.createElement('hr'));
    pane.append(cardArticle(card, true));
  }
}

function pinButton(id, pinned) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.innerHTML = pinned ? ICONS.close : ICONS.pin;
  btn.title = pinned ? 'Unpin' : 'Pin';
  btn.setAttribute('aria-label', pinned ? 'Unpin card' : 'Pin card');
  btn.onclick = () => togglePin(id);
  return btn;
}

function cardArticle(card, pinned) {
  const article = document.createElement('article');
  const view = state.mode === 'view';

  if (view) {
    article.classList.add('clickable');
    if (pinned || state.pinned.has(card.id)) article.classList.add('is-pinned');
    article.onclick = event => {
      if (event.target.closest('a')) return;
      togglePin(card.id);
    };
  } else {
    const head = document.createElement('div');
    head.className = 'card-head';
    const title = document.createElement('h2');
    title.textContent = card.name;
    head.append(title, pinButton(card.id, pinned));
    article.append(head);
  }

  const tags = document.createElement('div');
  tags.className = 'card-tags';
  for (const tag of card.tags) {
    const chip = document.createElement('span');
    chip.textContent = '#' + tag;
    tags.append(chip);
  }

  const body = document.createElement('div');
  body.className = 'md';
  body.innerHTML = window.marked ? marked.parse(card.md) : `<pre>${escapeHtml(card.md)}</pre>`;

  article.append(tags, body);
  if (!view) article.append(actionButtons(card));
  return article;
}

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
}

const JUNK_LINE = /^(?:https?:\/\/|#|\(\d+X\)|\[\d+X\]|[-_]{4,})/;

function firstStanza(md) {
  for (const block of md.split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every(l => JUNK_LINE.test(l.replace(/\*/g, '')))) continue;
    return lines.join('\n');
  }
  return '';
}

function pickRandomStudy(pool) {
  if (pool.length === 1) return pool[0].id;
  let candidate;
  do {
    candidate = pool[Math.floor(Math.random() * pool.length)];
  } while (candidate.id === state.studyCardId);
  return candidate.id;
}

function renderStudy(pane) {
  const pool = visibleCards();
  $('#count').textContent = `${pool.length} card${pool.length === 1 ? '' : 's'}`;

  if (!pool.length) {
    pane.append(hint(allCards().length
      ? 'No cards match the selected hashtags.'
      : 'No cards yet — use Import in Edit mode to load songs.'));
    return;
  }
  if (!pool.some(card => card.id === state.studyCardId)) {
    state.studyCardId = pickRandomStudy(pool);
    state.studyRevealed = false;
  }
  const card = pool.find(c => c.id === state.studyCardId);

  const el = document.createElement('article');
  el.className = 'study-card' + (state.studyRevealed ? ' revealed' : '');

  const content = document.createElement('div');
  content.className = 'md';
  content.innerHTML = window.marked
    ? marked.parse(state.studyRevealed ? card.md : firstStanza(card.md))
    : `<pre>${escapeHtml(state.studyRevealed ? card.md : firstStanza(card.md))}</pre>`;
  el.append(content);

  if (state.studyRevealed) {
    const tags = document.createElement('div');
    tags.className = 'card-tags';
    for (const tag of card.tags) {
      const chip = document.createElement('span');
      chip.textContent = '#' + tag;
      tags.append(chip);
    }
    el.append(tags);
  }

  const tip = document.createElement('p');
  tip.className = 'muted hint study-hint';
  tip.textContent = state.studyRevealed ? 'Tap for the next song' : 'Tap to reveal the full song';
  el.append(tip);

  el.onclick = event => {
    if (event.target.closest('a')) return;
    if (state.studyRevealed) {
      state.studyCardId = pickRandomStudy(pool);
      state.studyRevealed = false;
    } else {
      state.studyRevealed = true;
    }
    renderCards();
  };

  pane.append(el);
}

function actionButtons(card) {
  const row = document.createElement('div');
  row.className = 'actions';
  row.append(
    button('Edit', () => { state.editingId = card.id; refresh(); }),
    button('Export .md', () => exportCard(card)),
    button('Delete', () => {
      if (!confirm(`Delete ${card.name}?`)) return;
      removeCard(card.id);
      state.pinned.delete(card.id);
      savePinned(state.pinned);
      refresh();
    }),
  );
  return row;
}

function editorForm() {
  const existing = state.editingId === 'new'
    ? undefined
    : allCards().find(c => c.id === state.editingId);

  const form = document.createElement('form');
  const name = document.createElement('input');
  name.placeholder = 'file name (e.g. closures.md)';
  name.value = existing?.name ?? '';

  const text = document.createElement('textarea');
  text.placeholder = 'Markdown body…\n\n#tag1 #tag2';
  text.value = existing ? serializeCard(existing) : '';

  form.append(name, text,
    button('Save', null, { type: 'submit' }),
    button('Cancel', discardEditor));

  form.onsubmit = event => {
    event.preventDefault();
    const card = parseCard(name.value || 'untitled.md', text.value, existing?.id);
    saveCard(card);
    discardEditor();
  };
  return form;
}

function discardEditor() {
  state.editingId = null;
  refresh();
}

function button(label, onclick, attrs = {}) {
  const btn = document.createElement('button');
  btn.textContent = label;
  Object.assign(btn, attrs);
  if (onclick) btn.onclick = onclick;
  return btn;
}

const YT_ID = /(?:youtu\.be\/|v=|\/shorts\/)([\w-]{11})/;
const YT_ALL = /youtu(?:\.be\/|be\.com\/(?:watch\?v=|shorts\/))([\w-]{11})/g;

document.addEventListener('click', event => {
  const link = event.target.closest('a[href*="youtu"]');
  if (!link) return;
  const id = link.href.match(YT_ID)?.[1];
  if (!id) return;
  event.preventDefault();
  playOne(id, startSeconds(link.href));
});

$('#play-all').onclick = () => (playingAll ? closePlayer() : playAll());

let player = null;
let playingAll = false;
let queue = [];
let position = 0;
let openToken = 0;

function startSeconds(url) {
  return Number(url.match(/[?&](?:t|start)=(\d+)/)?.[1] ?? 0);
}

let apiPromise = null;

function youTubeApi() {
  apiPromise ??= new Promise(resolve => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  });
  return apiPromise;
}

async function showPlayer(videoId, start = 0) {
  const token = ++openToken;
  $('#player').hidden = false;
  if (!window.YT?.Player) {
    await Promise.race([youTubeApi(), new Promise(r => setTimeout(r, 4000))]);
    if (token !== openToken || $('#player').hidden) return;
    if (!window.YT?.Player) return plainIframe(videoId, start);
  }
  if (player) player.loadVideoById(start ? { videoId, startSeconds: start } : { videoId });
  else createPlayer(videoId, start);
}

function createPlayer(videoId, start) {
  $('#player-frame').innerHTML = '<div id="yt-player"></div>';
  player = new YT.Player('yt-player', {
    width: '100%',
    height: '100%',
    videoId,
    playerVars: { autoplay: 1, rel: 0, ...(start ? { start } : {}) },
    events: { onStateChange: ({ data }) => data === 0 && onEnded() },
  });
}

function plainIframe(videoId, start) {
  $('#player-frame').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0${start ? `&start=${start}` : ''}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
}

function playOne(id, start) {
  playingAll = false;
  syncPlayAllButton();
  setInfo('');
  showPlayer(id, start);
}

function playAll() {
  const ids = shuffle([...new Set(visibleCards()
    .flatMap(card => [...card.md.matchAll(YT_ALL)].map(match => match[1])))]);
  if (!ids.length) return;
  queue = ids;
  position = 0;
  playingAll = true;
  syncPlayAllButton();
  setInfo(`1 / ${queue.length}`);
  showPlayer(queue[0]);
}

function onEnded() {
  if (!playingAll || position >= queue.length - 1) return closePlayer();
  position++;
  setInfo(`${position + 1} / ${queue.length}`);
  player?.loadVideoById({ videoId: queue[position] });
}

function closePlayer() {
  openToken++;
  $('#player').hidden = true;
  $('#player-frame').textContent = '';
  player = null;
  playingAll = false;
  queue = [];
  position = 0;
  setInfo('');
  syncPlayAllButton();
}

function setInfo(text) {
  $('#player-info').textContent = text;
}

function syncPlayAllButton() {
  $('#play-all').textContent = playingAll ? 'Stop' : 'Play all';
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const DRIVE_KEY = 'flashcards.drive';
let driveState = JSON.parse(localStorage.getItem(DRIVE_KEY) ?? '{}');
driveState.files ??= {};

function saveDriveState() {
  localStorage.setItem(DRIVE_KEY, JSON.stringify(driveState));
}

const clientId = () => localStorage.getItem('flashcards.clientId') || DRIVE_CLIENT_ID;

function driveStatus(text) {
  const el = $('#drive-status');
  if (el) el.textContent = text;
}

function openDriveDialog() {
  let dialog = $('#drive-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'drive-dialog';
    document.body.append(dialog);
  }
  dialog.innerHTML = `
    <h2>Google Drive</h2>
    <p class="muted hint">Paste a link to a Drive folder you have access to.
      Pull imports its .md songs; Push uploads your cards.</p>
    <input id="drive-folder" placeholder="https://drive.google.com/drive/folders/…">
    <div class="dialog-actions">
      <button id="drive-pull">Pull</button>
      <button id="drive-push">Push all</button>
      <button id="drive-close" type="button">Close</button>
    </div>
    <p id="drive-status" class="muted hint"></p>`;
  dialog.querySelector('#drive-folder').value = driveState.folderLink ?? '';
  dialog.querySelector('#drive-close').onclick = () => dialog.close();
  dialog.querySelector('#drive-pull').onclick = () => runDrive(pullFromDrive);
  dialog.querySelector('#drive-push').onclick = () => runDrive(pushToDrive);
  dialog.showModal();
}

async function runDrive(action) {
  if (!clientId()) return driveStatus('Missing OAuth client ID — set it in js/config.js.');
  const folderId = parseFolderLink($('#drive-folder').value);
  if (!folderId) return driveStatus('Paste a valid folder link first.');
  driveState.folderLink = $('#drive-folder').value.trim();
  saveDriveState();
  driveStatus('Connecting to Google…');
  try {
    await connect(clientId());
    driveStatus('Syncing…');
    await action(folderId);
  } catch (error) {
    driveStatus(`Error: ${error.message}`);
  }
}

async function pullFromDrive(folderId) {
  const tracked = driveState.files;
  const remotes = await listMarkdown(folderId);
  driveState.folderId = folderId;

  const fresh = [];
  const conflicts = [];
  for (const file of remotes) {
    const entry = tracked[file.id];
    const card = entry && allCards().find(c => c.id === entry.cardId);
    if (!card) fresh.push(file);
    else if (file.modifiedTime === entry.modifiedTime) continue;
    else if (hashText(serializeCard(card)) === entry.mdHash) fresh.push(file);
    else conflicts.push(file);
  }
  let kept = 0;
  if (conflicts.length && !confirm(
    `${conflicts.length} song(s) changed both on Drive and locally:\n` +
    conflicts.map(f => f.name).join('\n') +
    '\n\nReplace the local edits with the Drive versions?')) {
    kept = conflicts.length;
  } else fresh.push(...conflicts);

  for (const file of fresh) {
    const existing = allCards().find(c => c.name === file.name);
    const card = parseCard(file.name, await readFile(file.id), existing?.id);
    saveCard(card);
    tracked[file.id] = {
      cardId: card.id,
      name: file.name,
      modifiedTime: file.modifiedTime,
      mdHash: hashText(serializeCard(card)),
    };
  }
  saveDriveState();
  refresh();
  driveStatus(`Pulled ${fresh.length} song(s)${kept ? `, kept ${kept} local edit(s)` : ''}.`);
}

async function pushToDrive(folderId) {
  driveState.folderId = folderId;
  const tracked = driveState.files;
  const byCard = new Map(Object.entries(tracked).map(([fileId, entry]) => [entry.cardId, fileId]));
  const cards = allCards();
  let created = 0, updated = 0, failed = 0, done = 0;

  for (const card of cards) {
    driveStatus(`Syncing ${++done}/${cards.length}…`);
    const digest = hashText(serializeCard(card));
    const fileId = byCard.get(card.id);
    try {
      if (fileId) {
        const entry = tracked[fileId];
        if (entry.mdHash === digest) continue;
        const remoteTime = await fileModifiedTime(fileId);
        if (remoteTime !== entry.modifiedTime &&
            !confirm(`'${card.name}' changed on Drive since your last sync. Overwrite it?`)) {
          entry.modifiedTime = remoteTime;
          continue;
        }
        const result = await writeFile(fileId, serializeCard(card));
        Object.assign(entry, { modifiedTime: result.modifiedTime, mdHash: digest });
        updated++;
      } else {
        const result = await createFile(folderId, card.name, serializeCard(card));
        tracked[result.id] = {
          cardId: card.id,
          name: card.name,
          modifiedTime: result.modifiedTime,
          mdHash: digest,
        };
        created++;
      }
    } catch (error) {
      failed++;
      console.warn(`${card.name}: ${error.message}`);
    }
  }
  saveDriveState();
  refresh();
  driveStatus(`Pushed ${created} created, ${updated} updated${failed ? `, ${failed} failed` : ''}.`);
}

refresh();

$('#player-close').onclick = closePlayer;
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closePlayer();
});
