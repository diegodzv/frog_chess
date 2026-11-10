// commitAndPush against a real (temporary) git repo with a bare remote, run from a directory that is not the
// repo root — as the workflows do (they start the scripts from scripts/).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commitAndPush } from '../lib/commitAndPush.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

function repoWithRemote() {
  const root = mkdtempSync(path.join(tmpdir(), 'frog-git-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, work);
  git(work, 'config', 'user.name', 'test');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'core.autocrlf', 'false');
  mkdirSync(path.join(work, 'data'));
  mkdirSync(path.join(work, 'scripts'));
  writeFileSync(path.join(work, 'data', 'a.json'), '{}\n');
  writeFileSync(path.join(work, 'scripts', 'x.mjs'), '\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'init');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  return { remote, work };
}

test('commits and pushes data/ changes even when the process runs from another directory', () => {
  const { remote, work } = repoWithRemote();
  const env = process.env.FROG_SKIP_GIT;
  delete process.env.FROG_SKIP_GIT;
  try {
    assert.notEqual(process.cwd(), work);
    writeFileSync(path.join(work, 'data', 'a.json'), '{"x":1}\n');
    writeFileSync(path.join(work, 'scripts', 'x.mjs'), '// not data\n');
    assert.equal(commitAndPush('sync: test', { cwd: work }), true);
    assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'sync: test');
    assert.deepEqual(git(remote, 'show', '--name-only', '--format=', 'main').split('\n'), ['data/a.json'], 'solo data/');

    assert.equal(commitAndPush('sync: nada', { cwd: work }), false, 'sin cambios en data/ no hay commit');
    assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'sync: test');
  } finally {
    if (env !== undefined) process.env.FROG_SKIP_GIT = env;
  }
});
