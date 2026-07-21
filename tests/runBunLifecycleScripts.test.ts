import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  collectLifecycleTasks,
  parseDefaultTrustedDependencies,
} from '../.github/actions/run-bun-lifecycle-scripts/run.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('collectLifecycleTasks', () => {
  test('replays only explicit or registry-backed default trusted dependencies, then root scripts', async () => {
    const cwd = await createFixture();
    const tasks = await collectLifecycleTasks({
      cwd,
      defaultTrustedDependencies: new Set(['default-package', 'git-spoof']),
    });

    expect(tasks.map(({ lifecycleName, packageName }) => `${packageName}:${lifecycleName}`)).toEqual([
      'default-package@1.0.0:postinstall',
      'explicit-package@1.0.0:install',
      'nested-package@2.0.0:preinstall',
      'fixture:postinstall',
      'fixture:prepare',
    ]);
  });
});

test('parseDefaultTrustedDependencies ignores Bun headings and prose', () => {
  expect(
    [...parseDefaultTrustedDependencies('bun pm default-trusted v1.3.14\n\n - esbuild\n - @prisma/client\n')],
  ).toEqual(['esbuild', '@prisma/client']);
});

const createFixture = async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'bun-lifecycle-'));
  temporaryDirectories.push(cwd);
  await writeJson(path.join(cwd, 'package.json'), {
    name: 'fixture',
    scripts: { postinstall: 'true', prepare: 'true' },
    trustedDependencies: ['explicit-package', 'nested-package'],
  });
  await writeJson(path.join(cwd, 'bun.lock'), {
    packages: {
      'default-package': ['default-package@1.0.0', '', {}],
      'git-spoof': ['git-spoof@git+https://example.invalid/spoof.git', '', {}],
    },
  });

  const store = path.join(cwd, 'node_modules', '.bun');
  await createPackage(path.join(store, 'default-package@1.0.0', 'node_modules', 'default-package'), {
    name: 'default-package',
    version: '1.0.0',
    scripts: { postinstall: 'true' },
  });
  await createPackage(path.join(store, 'explicit-package@1.0.0', 'node_modules', 'explicit-package'), {
    name: 'explicit-package',
    version: '1.0.0',
    scripts: { install: 'true' },
  });
  await createPackage(
    path.join(
      store,
      'explicit-package@1.0.0',
      'node_modules',
      'explicit-package',
      'node_modules',
      'nested-package',
    ),
    {
      name: 'nested-package',
      version: '2.0.0',
      scripts: { preinstall: 'true' },
    },
  );
  await createPackage(path.join(store, 'git-spoof@1.0.0', 'node_modules', 'git-spoof'), {
    name: 'git-spoof',
    version: '1.0.0',
    scripts: { postinstall: 'false' },
  });
  await symlink(
    path.join(store, 'explicit-package@1.0.0', 'node_modules', 'explicit-package'),
    path.join(cwd, 'node_modules', 'explicit-package'),
  );
  return cwd;
};

const createPackage = async (directory: string, packageJson: object) => {
  await mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, 'package.json'), packageJson);
};

const writeJson = async (file: string, value: object) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
};
