import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './repoData.mjs';

// Always run git at the repo root: the workflows start the scripts from scripts/, where a relative `data`
// pathspec matches nothing ("git add data" failed in every sync run on GitHub Actions).
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

/** True if something under data/ is staged. */
function hasStagedChanges(cwd) {
  try {
    git(['diff', '--cached', '--quiet', '--', 'data'], cwd);
    return false;
  } catch {
    return true; // exit code 1: there are staged differences
  }
}

/**
 * Stages everything under `data/`, commits if there's anything to commit, and
 * pushes with a small pull-rebase retry loop to survive a concurrent human
 * push (e.g. someone merging a PR to overrides.json mid-run).
 *
 * Returns true if a commit was made, false if there was nothing to commit.
 */
export function commitAndPush(message, { attempts = 3, cwd = REPO_ROOT } = {}) {
  // FROG_SKIP_GIT=1 lets the scripts run locally (or against simulated data)
  // without committing or pushing anything.
  if (process.env.FROG_SKIP_GIT === '1') return false;

  git(['add', 'data'], cwd);
  if (!hasStagedChanges(cwd)) return false;

  git(['commit', '-m', message], cwd);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      git(['push'], cwd);
      return true;
    } catch (err) {
      if (attempt === attempts) throw err;
      git(['pull', '--rebase'], cwd);
    }
  }
  return true;
}
