// Snapshots the working-tree changes produced by the repository's fixers into ONE JSON file.
//
// A single well-known filename is deliberate: the applier downloads this artifact, and if the
// archive itself carried the fixers' paths, extraction would be the point where an attacker-chosen
// path takes effect. Keeping every attacker-controlled path INSIDE the JSON makes them mere data
// that the applier validates before use.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const { EXCLUDE_PATHS: excludePaths = '', EXPECTED_HEAD_SHA: expectedHeadSha, RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: githubOutput } = process.env;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function setOutput(key, value) {
  appendFileSync(githubOutput, `${key}=${value}\n`);
}

// The patch is committed onto the pull request head, so it is only valid if the fixers ran against
// that exact tree. Hosted runs check out the merge ref instead, where the resulting contents would
// silently include the base branch's state; refuse rather than commit a subtly wrong file.
const headSha = git('rev-parse', 'HEAD').trim();
if (expectedHeadSha && headSha !== expectedHeadSha) {
  console.log(
    `::warning::Working tree is at ${headSha}, not the pull request head ${expectedHeadSha}, so no autofix patch was produced.`
  );
  setOutput('has_patch', 'false');
  process.exit(0);
}

git('add', '--all');
const excluded = new Set(excludePaths.split('\n').map((line) => line.trim()).filter(Boolean));
// --no-renames keeps every change expressible as a plain addition/deletion pair, which is exactly
// the shape createCommitOnBranch takes. core.quotepath=false stops git from escaping non-ASCII
// paths into octal, which would not round-trip through the applier.
const changed = git('-c', 'core.quotepath=false', 'diff', '--staged', '--name-only', '--no-renames')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !excluded.has(line));

if (changed.length === 0) {
  setOutput('has_patch', 'false');
  process.exit(0);
}

// Mirrors the applier's enforcing check so the failure is reported here, where the diff is
// visible, instead of surfacing as an opaque rejection in a separate workflow run.
const forbidden = changed.filter((file) => file === '.github' || file.startsWith('.github/') || file.startsWith('.git/'));
if (forbidden.length > 0) {
  console.log(`::error::Autofix must not modify ${forbidden.join(', ')}; refusing to produce a patch.`);
  process.exit(1);
}

const additions = [];
const deletions = [];
for (const file of changed) {
  try {
    additions.push({ path: file, contents: readFileSync(file).toString('base64') });
  } catch {
    // Unreadable means the fixers removed it; git already staged that deletion.
    deletions.push({ path: file });
  }
}

const outputDirectory = path.join(runnerTemp, 'autofix-patch');
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  path.join(outputDirectory, 'autofix.json'),
  JSON.stringify({ version: 1, headSha, changes: { additions, deletions } })
);

console.log(`Collected ${additions.length} addition(s) and ${deletions.length} deletion(s):`);
for (const file of changed) console.log(`  ${file}`);
setOutput('has_patch', 'true');
setOutput('patch_directory', outputDirectory);
