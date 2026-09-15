import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from './release-notes.mjs';

function fixture(t, tagged) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'boite-release-notes-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  let input = '';
  for (const [i, subject] of ['old release', 'fix: keep `busy` [visible]', 'chore: release 1.4.3'].entries()) {
    input += `commit refs/heads/main\nmark :${i + 1}\ncommitter meetsu <96637888+klNuno@users.noreply.github.com> ${1700000000 + i} +0000\ndata ${Buffer.byteLength(subject)}\n${subject}\n${i ? `from :${i}\n` : ''}\n`;
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd, input });
  git('checkout', '--quiet', 'main');
  if (tagged) git('tag', 'v1.4.2', 'HEAD~2');
  return { cwd, git };
}

test('lists only commits since the previous release, including on a tagged HEAD', (t) => {
  const { cwd, git } = fixture(t, true);
  const beforeTag = releaseNotes('beboite/boite-legacy', cwd);
  git('tag', 'v1.4.3');
  assert.equal(releaseNotes('beboite/boite-legacy', cwd), beforeTag);
  assert.equal(beforeTag.split('\n').length, 2);
  assert.ok(!beforeTag.includes('old release'));
  assert.ok(beforeTag.includes('fix: keep \\`busy\\` \\[visible\\]'));
  assert.ok(beforeTag.includes(`/commit/${git('rev-parse', 'HEAD')}`));
});

test('lists the entire history for the first release', (t) => {
  const { cwd } = fixture(t, false);
  assert.equal(releaseNotes('beboite/boite-legacy', cwd).split('\n').length, 3);
});

test('rejects an invalid repository before constructing links', () => {
  assert.throws(() => releaseNotes('https://example.com/bad'), /repository/);
});

test('exports the complete multiline changelog as a GitHub Actions output', (t) => {
  const { cwd } = fixture(t, true);
  const output = path.join(cwd, 'output');
  execFileSync(process.execPath, [fileURLToPath(new URL('./release-notes.mjs', import.meta.url))], {
    cwd, env: { ...process.env, GITHUB_REPOSITORY: 'beboite/boite-legacy', GITHUB_OUTPUT: output },
  });
  const [header, ...lines] = readFileSync(output, 'utf8').trimEnd().split('\n');
  assert.ok(header.startsWith('notes<<'));
  assert.equal(lines.pop(), header.slice('notes<<'.length));
  assert.equal(lines.join('\n'), releaseNotes('beboite/boite-legacy', cwd));
});
