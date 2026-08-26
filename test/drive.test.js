import test from 'node:test';
import assert from 'node:assert/strict';
import './support/local-storage.js';

const { scanFolder, readFile, hashText } = await import('../js/drive.js');

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

const json = body => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });

function fakeDrive({ childrenByParent = {}, metaById = {}, contentById = {} }) {
  const parentQueries = [];
  globalThis.fetch = async url => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/drive/v3/files') {
      const parents = [...searchParams.get('q').matchAll(/'([^']+)' in parents/g)].map(m => m[1]);
      parentQueries.push(parents);
      return json({ files: parents.flatMap(id => childrenByParent[id] ?? []) });
    }
    const id = pathname.split('/').pop();
    if (searchParams.get('alt') === 'media') return { ok: true, text: async () => contentById[id] };
    return json(metaById[id]);
  };
  return parentQueries;
}

test('scanFolder separa .md de outros arquivos e desce em subpastas', async () => {
  fakeDrive({
    childrenByParent: {
      root: [
        { id: 'f1', name: 'a.md', mimeType: 'text/markdown' },
        { id: 'f2', name: 'b.pdf', mimeType: 'application/pdf' },
        { id: 'f3', name: 'doc.md', mimeType: 'application/vnd.google-apps.document' },
        { id: 'sub', name: 'sub', mimeType: FOLDER },
      ],
      sub: [{ id: 'f4', name: 'c.MD', mimeType: 'text/plain' }],
    },
  });
  const result = await scanFolder('root');
  assert.deepEqual(result.markdown.map(f => f.name).sort(), ['a.md', 'c.MD']);
  assert.deepEqual(result.others.map(f => f.name).sort(), ['b.pdf', 'doc.md']);
  assert.equal(result.failed, 0);
});

test('scanFolder resolve atalhos para o arquivo alvo', async () => {
  fakeDrive({
    childrenByParent: {
      root: [{ id: 's1', name: 'atalho', mimeType: SHORTCUT, shortcutDetails: { targetId: 't1' } }],
    },
    metaById: { t1: { id: 't1', name: 'alvo.md', mimeType: 'text/markdown' } },
  });
  const result = await scanFolder('root');
  assert.deepEqual(result.markdown.map(f => f.id), ['t1']);
});

test('scanFolder não revisita pastas nem entra em laço com ciclos', async () => {
  const queries = fakeDrive({
    childrenByParent: {
      root: [{ id: 'sub', name: 'sub', mimeType: FOLDER }],
      sub: [{ id: 'root', name: 'root', mimeType: FOLDER }],
    },
  });
  const result = await scanFolder('root');
  assert.equal(result.failed, 0);
  assert.equal(queries.length, 2);
});

test('scanFolder consulta no máximo 10 pastas por requisição', async () => {
  const subfolders = Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, name: `d${i}`, mimeType: FOLDER }));
  const queries = fakeDrive({ childrenByParent: { root: subfolders } });
  await scanFolder('root');
  assert.equal(queries.length, 4);
  assert.ok(queries.every(parents => parents.length <= 10));
});

test('scanFolder segue paginação via nextPageToken', async () => {
  globalThis.fetch = async url => {
    const token = new URL(url).searchParams.get('pageToken');
    return token
      ? json({ files: [{ id: 'f2', name: 'b.md', mimeType: 'text/markdown' }] })
      : json({
          files: [{ id: 'f1', name: 'a.md', mimeType: 'text/markdown' }],
          nextPageToken: 'p2',
        });
  };
  const result = await scanFolder('root');
  assert.deepEqual(result.markdown.map(f => f.name), ['a.md', 'b.md']);
});

test('scanFolder conta pastas inacessíveis em vez de quebrar', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  const result = await scanFolder('root');
  assert.equal(result.failed, 1);
  assert.deepEqual(result.markdown, []);
});

test('readFile baixa o conteúdo do arquivo', async () => {
  fakeDrive({ contentById: { f1: '# olá' } });
  assert.equal(await readFile('f1'), '# olá');
});

test('hashText é determinístico e sensível ao conteúdo', () => {
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
});
