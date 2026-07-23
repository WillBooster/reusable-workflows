# reusable-workflows

[![Test](https://github.com/WillBooster/reusable-workflows/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/reusable-workflows/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/reusable-workflows/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/reusable-workflows/actions/workflows/test-rust.yml)
[![Deploy](https://github.com/WillBooster/reusable-workflows/actions/workflows/deploy.yml/badge.svg)](https://github.com/WillBooster/reusable-workflows/actions/workflows/deploy.yml)

A collection of reusable workflows for GitHub Actions.

## Secrets contract for callers

The five install-capable workflows (`test.yml`, `deploy.yml`, `release.yml`, `run-script.yml`, `autofix.yml`) declare these optional secrets:

- `VERDACCIO_TOKEN`: auth token for the private Verdaccio registry (`@willbooster-private/*`). When set, the workflow generates a git-excluded workspace `.npmrc` before installing dependencies. Every caller should pass it. The generated `.npmrc` stays on disk for the whole job, but the secret itself is step-scoped: `${VERDACCIO_TOKEN}` only expands in the "Install dependencies" step of all five workflows, plus `common/ci-setup` and "Deploy" in `deploy.yml`, `common/ci-setup` and "Run script" in `run-script.yml`, "Release" in `release.yml`, and "Test release script" in `test.yml`. Consumer scripts running on any other step (e.g. `test/ci-setup`, `cleanup`, `build`, tests) see an empty `VERDACCIO_TOKEN` and must rely on the already-installed dependency graph instead of fetching from the private registry at run time.
- `TAKUMI_GUARD_TOKEN`: auth token for the [Takumi Guard](https://flatt.tech/takumi/features/guard) registry proxy, which blocks known-malicious packages. When set, the generated `.npmrc` also routes DEFAULT-registry (public npm) installs through `https://npm.flatt.tech/`; scoped registries such as `@willbooster-private` (Verdaccio) keep their own registry, so private packages are unaffected. The token follows the same step-scoping as `VERDACCIO_TOKEN` (it only attributes requests to the organization — the proxy also serves anonymously, so steps with an empty token still install). Yarn Berry ignores `.npmrc`, so Guard does not apply to Berry installs.
- `FNOX_AGE_KEY`: age secret key that decrypts the age-encrypted secrets committed in the caller's `fnox.toml`. Required for repositories whose `fnox.toml` contains age-encrypted secrets; after mise installs fnox, `deploy.yml`, `release.yml`, and `run-script.yml` fail fast when the committed secrets cannot be resolved (missing or wrong key), while `test.yml` and `autofix.yml` only warn (fork pull requests run `test.yml` without secrets, and autofix's cleanup/build steps do not need app secrets). A `fnox.toml` with only plaintext defaults needs no key, but a non-development job must still declare the selected profile (an inline `[profiles.<name>]` or a `fnox.<name>.toml` file) — an undeclared profile silently falls back to the base (development) secrets, so the check rejects it.

Do NOT pass these secrets explicitly to the other workflows (e.g. `semantic-pr.yml`, `close-comment.yml`): GitHub rejects a `secrets:` map entry the callee does not declare (`secrets: inherit` is exempt from this validation). Running `wbfy` (>= 3.0.0) on the caller repository injects `VERDACCIO_TOKEN`/`FNOX_AGE_KEY` automatically.

## GITHUB_TOKEN instead of SSH deploy keys

Self-hosted runners no longer need an SSH deploy key: every checkout uses `actions/checkout` (HTTPS + `GITHUB_TOKEN`), and the push-back in `test.yml`/`autofix.yml` reuses the credential persisted by `actions/checkout`. Because a `GITHUB_TOKEN` push does not trigger other workflows, both workflows explicitly dispatch the consumer's `.github/workflows/test.yml` against the pushed commit afterwards ([technique](https://toranoana-lab.hatenablog.com/entry/2025/08/20/100000)), and `test.yml` reports a commit status when it runs from `workflow_dispatch` (such runs do not attach to pull-request checks). Callers therefore need on their `GITHUB_TOKEN`:

- `contents: write` — for the autofix push-back (`test.yml`, `autofix.yml`);
- `actions: write` — to dispatch the test workflow after a push-back;
- `statuses: write` — for the commit status of dispatched runs;

and the consumer's caller `test.yml` should declare a `workflow_dispatch:` trigger so the dispatched re-run is possible (its absence only produces a workflow warning).

Note: this repository is mirrored to `WillBoosterLab/reusable-workflows` with `one-way-git-sync` via the `sync` script, which maintainers run from their machines (`bun run sync`; `renovate.json` and `node_modules` are excluded). The mirror is not synced automatically on merge, so it can lag `main` — run `bun run sync` after merging changes that WillBoosterLab callers need.
