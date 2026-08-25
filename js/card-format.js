const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;

export function parseCard(fileName, text, id = crypto.randomUUID()) {
  const lines = text.trimEnd().split('\n');
  let bodyEnd = lines.length;
  while (bodyEnd > 0 && isTagLine(lines[bodyEnd - 1])) bodyEnd--;

  const tags = [...new Set(
    [...lines.slice(bodyEnd).join(' ').matchAll(TAG_RE)].map(m => m[1].toLowerCase()),
  )];

  return { id, name: fileName, tags, md: lines.slice(0, bodyEnd).join('\n').trim() };
}

function isTagLine(line) {
  const words = line.trim().split(/\s+/);
  return words[0] !== '' && words.every(w => /^#[\p{L}\p{N}_-]+$/u.test(w));
}

export function serializeCard({ md, tags }) {
  return `${md}\n\n${tags.map(t => '#' + t).join(' ')}\n`;
}
