#!/usr/bin/env bash
set -euo pipefail

scratch_root=$1
repo="$scratch_root/repo"
remote="$scratch_root/remote.git"

mkdir -p "$repo"
git init -q --bare "$remote"
git -C "$repo" init -q
git -C "$repo" config user.name test
git -C "$repo" config user.email test@example.com
mkdir -p "$repo/.github/workflows"
printf 'base\n' > "$repo/kept.txt"
printf 'old\n' > "$repo/.github/workflows/modified.yml"
printf 'old\n' > "$repo/.github/workflows/deleted.yml"
git -C "$repo" add -A
git -C "$repo" commit -qm base
git -C "$repo" remote add origin "$remote"
git -C "$repo" push -q origin HEAD:main
git -C "$repo" push -q origin HEAD:wbfy

printf 'changed\n' > "$repo/kept.txt"
printf 'new\n' > "$repo/.github/workflows/modified.yml"
rm "$repo/.github/workflows/deleted.yml"
printf 'new\n' > "$repo/.github/workflows/added.yml"
git -C "$repo" add -A -- . ':(exclude).github/workflows'

printf '%s\n' '--- staged after exclusion ---'
git -C "$repo" status --short

git --git-dir="$remote" config core.hooksPath hooks
mkdir -p "$remote/hooks"
printf '#!/usr/bin/env bash\nexit 1\n' > "$remote/hooks/pre-receive"
chmod +x "$remote/hooks/pre-receive"

printf '%s\n' '--- workflow deletion command with the PR error handling ---'
(
  cd "$repo"
  git push origin --delete wbfy --no-verify 2>/dev/null || true
  printf '%s\n' 'reported-success'
)
printf '%s\n' '--- remote wbfy after rejected deletion ---'
git --git-dir="$remote" show-ref refs/heads/wbfy
