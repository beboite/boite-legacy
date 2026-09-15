import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function releaseNotes(repository, cwd = process.cwd()) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
    throw new Error('expected a GitHub repository in owner/name form');
  }
  const git = (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  let previous;
  try {
    // Starting at the parent excludes the release tag on HEAD on tag builds.
    previous = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD^');
  } catch {
    // The first release has no previous tag and includes the whole history.
  }
  const log = git('log', '--reverse', '--format=%H%x09%s', previous ? `${previous}..HEAD` : 'HEAD');
  return log.split('\n').filter(Boolean).map((line) => {
    const [sha, ...parts] = line.split('\t');
    const subject = parts.join('\t').replace(/[\\`*_{}[\]<>()!|]/g, '\\$&');
    return `- ${subject} ([${sha.slice(0, 8)}](https://github.com/${repository}/commit/${sha}))`;
  }).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const notes = releaseNotes(process.env.GITHUB_REPOSITORY);
  console.log(notes);
  if (process.env.GITHUB_OUTPUT) {
    const delimiter = randomUUID();
    appendFileSync(process.env.GITHUB_OUTPUT, `notes<<${delimiter}\n${notes}\n${delimiter}\n`);
  }
}
