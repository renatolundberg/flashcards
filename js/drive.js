const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';

export const session = { token: null, expiresAt: 0 };

export function parseFolderLink(text) {
  const value = text.trim();
  const fromUrl = value.match(/folders\/([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{15,}$/.test(value) ? value : null;
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load Google Identity Services'));
    document.head.append(script);
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

async function driveFetch(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${session.token}`, ...options.headers },
  });
  if (!response.ok) throw new Error(`Drive API ${response.status}: ${await response.text()}`);
  return response;
}

export async function listMarkdown(folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'nextPageToken, files(id, name, modifiedTime)',
    pageSize: '200',
  });
  const files = [];
  do {
    const data = await driveFetch(`/drive/v3/files?${params}`).then(r => r.json());
    files.push(...data.files ?? []);
    params.set('pageToken', data.nextPageToken ?? '');
  } while (params.get('pageToken'));
  return files.filter(file => file.name.toLowerCase().endsWith('.md'));
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
