import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' });
}

function hasChanges() {
  return git(['status', '--porcelain']).trim().length > 0;
}

/**
 * Stages everything under `data/`, commits if there's anything to commit, and
 * pushes with a small pull-rebase retry loop to survive a concurrent human
 * push (e.g. someone merging a PR to overrides.json mid-run).
 *
 * Returns true if a commit was made, false if there was nothing to commit.
 */
export function commitAndPush(message, { attempts = 3 } = {}) {
  git(['add', 'data']);
  if (!hasChanges()) return false;

  git(['commit', '-m', message]);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      git(['push']);
      return true;
    } catch (err) {
      if (attempt === attempts) throw err;
      git(['pull', '--rebase']);
    }
  }
  return true;
}
