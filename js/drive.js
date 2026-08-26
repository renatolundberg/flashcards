const SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com';
const TOKEN_KEY = 'flashcards.driveToken';

export const session = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? '{"token":null,"expiresAt":0}');

export function hasValidToken() {
  return Boolean(session.token) && Date.now() < session.expiresAt - 60000;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

async function loadGis() {
  if (!window.google?.accounts?.oauth2) await loadScript('https://accounts.google.com/gsi/client');
}

async function loadPickerApi() {
  if (window.google?.picker) return;
  await loadScript('https://apis.google.com/js/api.js');
  if (!window.gapi) throw new Error('Google API loader failed');
  await new Promise((resolve, reject) => {
    gapi.load('picker', {
      callback: resolve,
      onerror: () => reject(new Error('Could not load Google Picker')),
    });
  });
}

async function requestToken(clientId, prompt) {
  return new Promise((resolve, reject) => {
    google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: response => response.error
        ? reject(new Error(response.error))
        : resolve(store(response)),
      error_callback: error => reject(new Error(error.type ?? 'popup_closed')),
    }).requestAccessToken({ prompt });
  });
}

function store(response) {
  session.token = response.access_token;
  session.expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
  localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
  return session.token;
}

export async function connect(clientId) {
  await loadGis();
  if (hasValidToken()) return session.token;
  try {
    return await requestToken(clientId, '');
  } catch {
    return requestToken(clientId, 'consent');
  }
}

export async function pickFolder(clientId, apiKey) {
  await connect(clientId);
  await loadPickerApi();
  const { picker } = window.google;
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');
    new picker.PickerBuilder()
      .setAppId(clientId.split('-')[0])
      .setDeveloperKey(apiKey)
      .setOAuthToken(session.token)
      .setTitle('Escolha uma pasta')
      .addView(view)
      .setCallback(data => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name } : null);
        } else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

async function driveFetch(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${session.token}`, ...options.headers },
  });
  if (!response.ok) throw new Error(`Drive API ${response.status}: ${await response.text()}`);
  return response;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const GOOGLE_MIME = 'application/vnd.google-apps.';
const PARENTS_PER_QUERY = 10;

async function resolveEntry(item) {
  if (item.mimeType !== SHORTCUT_MIME || !item.shortcutDetails?.targetId) return item;
  try {
    return await driveFetch(
      `/drive/v3/files/${item.shortcutDetails.targetId}?fields=id,name,mimeType,modifiedTime&supportsAllDrives=true`,
    ).then(r => r.json());
  } catch {
    return null;
  }
}

const isMarkdown = item => item.name.toLowerCase().endsWith('.md') &&
  !item.mimeType?.startsWith(GOOGLE_MIME);

export async function scanFolder(rootId) {
  const found = { markdown: [], others: [], failed: 0 };
  const seen = new Set([rootId]);
  let level = [rootId];
  while (level.length) {
    const next = [];
    for (let i = 0; i < level.length; i += PARENTS_PER_QUERY) {
      const batch = level.slice(i, i + PARENTS_PER_QUERY);
      try {
        for (const item of await listChildrenOf(batch)) {
          const entry = await resolveEntry(item);
          if (!entry) continue;
          if (entry.mimeType === FOLDER_MIME) {
            if (!seen.has(entry.id)) { seen.add(entry.id); next.push(entry.id); }
          } else (isMarkdown(entry) ? found.markdown : found.others).push(entry);
        }
      } catch {
        found.failed += batch.length;
      }
    }
    level = next;
  }
  return found;
}

async function listChildrenOf(folderIds) {
  const items = [];
  const params = new URLSearchParams({
    q: `(${folderIds.map(id => `'${id}' in parents`).join(' or ')}) and trashed = false`,
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, shortcutDetails)',
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  do {
    const data = await driveFetch(`/drive/v3/files?${params}`).then(r => r.json());
    items.push(...(data.files ?? []));
    params.set('pageToken', data.nextPageToken ?? '');
  } while (params.get('pageToken'));
  return items;
}

export async function readFile(fileId) {
  return driveFetch(`/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`).then(r => r.text());
}

export function hashText(text) {
  let hash = 5381;
  for (const char of text) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}
