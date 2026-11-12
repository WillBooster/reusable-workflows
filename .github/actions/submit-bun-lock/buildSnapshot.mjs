// Prints a dependency submission snapshot of every npm package resolved in ./bun.lock.
// GitHub's dependency graph does not parse bun.lock, so without it Dependabot alerts cover only the
// versions written in package.json files. It imports nothing outside the Bun runtime, so callers need
// no dependency installation.
import assert from 'node:assert/strict';

const LOCKFILE_PATH = 'bun.lock';

const env = {
  sha: process.env.GITHUB_SHA,
  ref: process.env.GITHUB_REF,
  runId: process.env.GITHUB_RUN_ID,
  workflow: process.env.GITHUB_WORKFLOW,
  job: process.env.GITHUB_JOB,
};
for (const [key, value] of Object.entries(env)) assert.ok(value, `${key} is required.`);

/**
 * `workspaces` maps a workspace path ('' for the root) to its name and dependency lists; `packages`
 * maps a key to `[name@resolution, registry, dependency lists, integrity]`, where workspace packages
 * have only the first element.
 */
const lockfile = Bun.JSONC.parse(await Bun.file(LOCKFILE_PATH).text());
assert.ok(lockfile.workspaces && lockfile.packages, `${LOCKFILE_PATH} has no workspaces or packages.`);

/** @type {Map<string, { package_url: string, relationship: 'direct' | 'indirect', scope: 'runtime' | 'development', dependencies: string[] }>} */
const resolved = new Map();
// Runtime roots first, so a package reachable from both keeps the runtime scope.
for (const scope of ['runtime', 'development']) {
  for (const [workspacePath, workspace] of Object.entries(lockfile.workspaces)) {
    // Bun keys a package that one workspace resolves differently under that workspace's name.
    const parentPath = workspacePath === '' ? [] : [workspaceNameOf(workspacePath)];
    for (const name of rootNamesOf(workspace, scope)) {
      visit(resolveKeyPath(parentPath, name), scope, true);
    }
  }
}

console.info(
  JSON.stringify({
    version: 0,
    sha: env.sha,
    ref: env.ref,
    job: { correlator: `${env.workflow} ${env.job}`, id: env.runId },
    detector: {
      name: 'reusable-workflows/submit-bun-lock',
      version: '1.0.0',
      url: 'https://github.com/WillBooster/reusable-workflows/tree/main/.github/actions/submit-bun-lock',
    },
    scanned: new Date().toISOString(),
    manifests: {
      [LOCKFILE_PATH]: {
        name: LOCKFILE_PATH,
        file: { source_location: LOCKFILE_PATH },
        resolved: Object.fromEntries(resolved),
      },
    },
  })
);

/** Records the package at `keyPath` and what it depends on, returning its package URL when it is an npm package. */
function visit(keyPath, scope, isDirect) {
  if (!keyPath) return;
  const entry = lockfile.packages[keyPath.join('/')];
  const { name, resolution } = splitNameAndResolution(entry[0]);
  if (resolution.startsWith('workspace:')) {
    // A workspace is not an npm package, but what it depends on is installed for its dependents.
    const workspace = lockfile.workspaces[resolution.slice('workspace:'.length)] ?? {};
    for (const dependencyName of rootNamesOf(workspace, 'runtime')) {
      visit(resolveKeyPath(keyPath, dependencyName), scope, isDirect);
    }
    return;
  }
  // git, github, file, and link resolutions have no npm package URL.
  if (resolution.includes(':')) return;

  const packageUrl = toPackageUrl(name, resolution);
  const existing = resolved.get(packageUrl);
  if (existing) {
    if (isDirect) existing.relationship = 'direct';
    return packageUrl;
  }
  const record = { package_url: packageUrl, relationship: isDirect ? 'direct' : 'indirect', scope, dependencies: [] };
  // Registered before recursing, so dependency cycles terminate.
  resolved.set(packageUrl, record);
  const lists = entry[2] ?? {};
  const dependencyNames = Object.keys({
    ...lists.dependencies,
    ...lists.optionalDependencies,
    ...lists.peerDependencies,
  });
  const dependencyUrls = dependencyNames.map((dependencyName) =>
    visit(resolveKeyPath(keyPath, dependencyName), scope, false)
  );
  record.dependencies = [...new Set(dependencyUrls.filter((url) => url !== undefined))];
  return packageUrl;
}

function rootNamesOf(workspace, scope) {
  return Object.keys(
    scope === 'runtime'
      ? { ...workspace.dependencies, ...workspace.optionalDependencies, ...workspace.peerDependencies }
      : { ...workspace.devDependencies }
  );
}

/**
 * Finds the lockfile key a dependency of the package at `parentPath` resolves to, following Bun's
 * hoisting: the nearest nested copy wins, falling back to shallower ones and then the top level.
 * Unresolvable names (e.g., unmet peers) give undefined.
 */
function resolveKeyPath(parentPath, name) {
  for (let depth = parentPath.length; depth >= 0; depth--) {
    const keyPath = [...parentPath.slice(0, depth), name];
    if (keyPath.join('/') in lockfile.packages) return keyPath;
  }
}

function workspaceNameOf(workspacePath) {
  const name = lockfile.workspaces[workspacePath]?.name;
  assert.ok(name, `The workspace ${workspacePath} has no name.`);
  return name;
}

function splitNameAndResolution(nameAndResolution) {
  // The separator is the first `@` after the name; a scoped name starts with its own `@`.
  const separatorIndex = nameAndResolution.indexOf('@', 1);
  assert.ok(separatorIndex > 0, `Unexpected package entry: ${nameAndResolution}`);
  return { name: nameAndResolution.slice(0, separatorIndex), resolution: nameAndResolution.slice(separatorIndex + 1) };
}

function toPackageUrl(name, version) {
  const encodedName = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}
