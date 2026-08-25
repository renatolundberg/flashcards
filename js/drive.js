const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';

export const session = { token: null, expiresAt: 0 };

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
  return session.token;
}

export async function connect(clientId) {
  await loadGis();
  if (session.token && Date.now() < session.expiresAt - 60000) return session.token;
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
const GOOGLE_MIME = 'application/vnd.google-apps.';

export async function listMarkdown(rootId) {
  const files = [];
  const queue = [rootId];
  while (queue.length) {
    const folderId = queue.shift();
    try {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
        pageSize: '200',
      });
      do {
        const data = await driveFetch(`/drive/v3/files?${params}`).then(r => r.json());
        for (const item of data.files ?? []) {
          if (item.mimeType === FOLDER_MIME) queue.push(item.id);
          else if (item.name.toLowerCase().endsWith('.md') &&
                   !item.mimeType?.startsWith(GOOGLE_MIME)) files.push(item);
        }
        params.set('pageToken', data.nextPageToken ?? '');
      } while (params.get('pageToken'));
    } catch (error) {
      console.warn(`Skipping unreadable folder ${folderId}: ${error.message}`);
    }
  }
  return files;
}

export async function readFile(fileId) {
  return driveFetch(`/drive/v3/files/${fileId}?alt=media`).then(r => r.text());
}

export async function fileModifiedTime(fileId) {
  return driveFetch(`/drive/v3/files/${fileId}?fields=modifiedTime`)
    .then(r => r.json())
    .then(data => data.modifiedTime);
}

export async function writeFile(fileId, text) {
  return driveFetch(
    `/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`,
    { method: 'PATCH', headers: { 'Content-Type': 'text/markdown' }, body: text },
  ).then(r => r.json());
}

export async function createFile(folderId, name, text) {
  const boundary = `flashcards${Date.now().toString(36)}`;
  const metadata = JSON.stringify({ name, parents: [folderId], mimeType: 'text/markdown' });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/markdown; charset=UTF-8',
    '',
    text,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return driveFetch(
    '/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  ).then(r => r.json());
}

export function hashText(text) {
  let hash = 5381;
  for (const char of text) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}
