import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const dependencyLifecycleNames = ['preinstall', 'install', 'postinstall'];
const repositoryLifecycleNames = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
];

export const collectLifecycleTasks = async ({
  cwd,
  defaultTrustedDependencies,
}) => {
  const rootPackage = await readPackageJson(path.join(cwd, 'package.json'));
  const explicitTrustedDependencies = new Set(rootPackage.trustedDependencies ?? []);
  const registryPackages = await readRegistryPackages(path.join(cwd, 'bun.lock'));
  const packageDirectories = await findInstalledPackageDirectories(cwd);
  const tasks = [];

  for (const directory of packageDirectories) {
    const packageJson = await readPackageJson(path.join(directory, 'package.json'));
    const resolution = `${packageJson.name}@${packageJson.version}`;
    const isExplicitlyTrusted = explicitTrustedDependencies.has(packageJson.name);
    const isDefaultTrustedRegistryPackage =
      defaultTrustedDependencies.has(packageJson.name) && registryPackages.has(resolution);
    if (!isExplicitlyTrusted && !isDefaultTrustedRegistryPackage) continue;

    for (const lifecycleName of dependencyLifecycleNames) {
      if (packageJson.scripts?.[lifecycleName]) {
        tasks.push({ directory, lifecycleName, packageName: resolution });
      }
    }
  }

  for (const lifecycleName of repositoryLifecycleNames) {
    if (rootPackage.scripts?.[lifecycleName]) {
      tasks.push({ directory: cwd, lifecycleName, packageName: rootPackage.name ?? 'repository' });
    }
  }

  return tasks;
};

export const parseDefaultTrustedDependencies = (output) =>
  new Set(
    output
      .split('\n')
      .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1])
      .filter(Boolean),
  );

const main = async () => {
  const cwd = process.cwd();
  const defaultTrustedResult = Bun.spawnSync(['bun', 'pm', 'default-trusted'], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (defaultTrustedResult.exitCode !== 0) {
    throw new Error('bun pm default-trusted failed');
  }

  const defaultTrustedDependencies = parseDefaultTrustedDependencies(
    defaultTrustedResult.stdout.toString(),
  );
  const tasks = await collectLifecycleTasks({ cwd, defaultTrustedDependencies });

  for (const task of tasks) {
    console.log(`Running ${task.packageName} ${task.lifecycleName}`);
    const subprocess = Bun.spawn(['bun', 'run', task.lifecycleName], {
      cwd: task.directory,
      env: process.env,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exitCode = await subprocess.exited;
    if (exitCode !== 0) {
      throw new Error(`${task.packageName} ${task.lifecycleName} exited with ${exitCode}`);
    }
  }
};

const findInstalledPackageDirectories = async (cwd) => {
  const nodeModules = path.join(cwd, 'node_modules');
  const bunStore = path.join(nodeModules, '.bun');
  const pendingNodeModules = [nodeModules];

  for (const storeEntry of await readDirectories(bunStore)) {
    pendingNodeModules.push(path.join(bunStore, storeEntry, 'node_modules'));
  }

  const candidates = [];
  const visitedNodeModules = new Set();
  while (pendingNodeModules.length > 0) {
    const currentNodeModules = pendingNodeModules.pop();
    let canonicalNodeModules;
    try {
      canonicalNodeModules = await realpath(currentNodeModules);
    } catch {
      continue;
    }
    if (visitedNodeModules.has(canonicalNodeModules)) continue;
    visitedNodeModules.add(canonicalNodeModules);

    const packageDirectories = await listPackageDirectories(currentNodeModules);
    candidates.push(...packageDirectories);
    pendingNodeModules.push(...packageDirectories.map((directory) => path.join(directory, 'node_modules')));
  }

  const uniqueDirectories = new Set();
  for (const candidate of candidates) {
    try {
      uniqueDirectories.add(await realpath(candidate));
    } catch {
      // Optional dependencies for other platforms can leave dangling links.
    }
  }
  return [...uniqueDirectories].sort();
};

const listPackageDirectories = async (nodeModules) => {
  const directories = [];
  for (const entry of await readDirectories(nodeModules)) {
    if (entry.startsWith('.')) continue;
    if (!entry.startsWith('@')) {
      directories.push(path.join(nodeModules, entry));
      continue;
    }
    for (const scopedEntry of await readDirectories(path.join(nodeModules, entry))) {
      directories.push(path.join(nodeModules, entry, scopedEntry));
    }
  }
  return directories;
};

const readDirectories = async (directory) => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const readPackageJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

const readRegistryPackages = async (lockfile) => {
  try {
    const lock = Bun.JSONC.parse(await readFile(lockfile, 'utf8'));
    return new Set(
      Object.values(lock.packages ?? {})
        .filter((entry) => Array.isArray(entry) && entry[1] === '')
        .map((entry) => entry[0]),
    );
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (process.env.TOLERATE_LIFECYCLE_FAILURE === 'true') {
      console.warn(`::warning::Lifecycle scripts failed: ${error.message}`);
    } else {
      throw error;
    }
  }
}
