# reusable-workflows

[![Test](https://github.com/WillBooster/reusable-workflows/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/reusable-workflows/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/reusable-workflows/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/reusable-workflows/actions/workflows/test-rust.yml)
[![Deploy](https://github.com/WillBooster/reusable-workflows/actions/workflows/deploy.yml/badge.svg)](https://github.com/WillBooster/reusable-workflows/actions/workflows/deploy.yml)

A collection of reusable workflows for GitHub Actions.

## Secrets contract for callers

The six install-capable workflows (`test.yml`, `deploy.yml`, `release.yml`, `run-script.yml`, `gen-pr.yml`, `autofix.yml`) declare these optional secrets:

- `VERDACCIO_TOKEN`: auth token for the private Verdaccio registry (`@willbooster-private/*`). When set, the workflow generates a git-excluded workspace `.npmrc` before installing dependencies. Every caller should pass it.
- `FNOX_AGE_KEY`: age secret key that decrypts the age-encrypted secrets committed in the caller's `fnox.toml`. Required for fnox-migrated repositories; `deploy.yml`, `release.yml`, `run-script.yml`, and `gen-pr.yml` fail fast when `fnox.toml` exists but the key is missing (`test.yml` only warns, because fork pull requests run without secrets).

Do NOT pass either secret to the other workflows (e.g. `semantic-pr.yml`, `close-comment.yml`); GitHub rejects passing a secret the callee does not declare. Running `wbfy` on the caller repository injects both automatically.

Note: pushes to `main` mirror this repository to `WillBoosterLab/reusable-workflows` via `one-way-git-sync` (see the `sync` script), so WillBoosterLab repositories call the mirror with identical content.
