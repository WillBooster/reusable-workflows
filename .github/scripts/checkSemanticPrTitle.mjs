import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const workflow = Bun.YAML.parse(await fs.readFile(".github/workflows/semantic-pr.yml", "utf8"));
const script = workflow.jobs["semantic-pr"].steps[0].run;
// Each case: [title, expected error patterns]; an empty list means the title must pass.
const cases = [
  ...["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"].map((type) => [`${type}: add x`, []]),
  ["feat(scope): add x", []],
  ["feat!: drop x", []],
  ["feat(a)!: x): y", []],
  ["chore(deps): update dependency lefthook to v2.1.14 (#523)", []],
  ["feat: café — emoji 🎉 한국어", []],
  ["feat: ok\nmore text", []],
  ["feat: x\r", []],
  ["Feat: x", [/Unknown release type "Feat"/]],
  ["foo: x", [/Unknown release type "foo"/]],
  ["feat x", [/No release type found/]],
  ["[WIP] feat: x", [/No release type found/]],
  ["feat:  ", [/No subject found/]],
  ["feat: 日本語", [/contains Japanese characters \(日 本 語\)/]],
  ["feat(日本): x", [/contains Japanese characters/]],
  ["feat(　): x", [/contains Japanese characters/]],
  ["feat: ok\n日本語", [/contains Japanese characters/]],
  ["feat: 𠮷 ｱｲｳ", [/contains Japanese characters/]],
  ["機能: 追加", [/No release type found/, /contains Japanese characters/]],
  ["feat: x\n::warning::injected", []],
  ["feat: ##[error]injected", []],
];

await fs.mkdir(".tmp", { recursive: true });
const root = await fs.mkdtemp(path.resolve(".tmp/semantic-pr-"));
// A local stand-in for the GitHub REST API; `/<index>` returns the title of `cases[index]`.
const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    const index = Number(new URL(request.url).pathname.slice(1));
    return index in cases ? Response.json({ title: cases[index][0] }) : new Response("Not Found", { status: 404 });
  },
});
try {
  // The runner writes `run` to an extension-less file for `shell: node {0}`.
  const scriptPath = path.join(root, "script");
  await fs.writeFile(scriptPath, script);
  const run = async (url) => {
    const proc = Bun.spawn(["node", scriptPath], { env: { ...process.env, GITHUB_TOKEN: "dummy", PULL_REQUEST_URL: url }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { stdout, stderr, status };
  };
  for (const [index, [title, patterns]] of cases.entries()) {
    const { stdout, stderr, status } = await run(`${server.url}${index}`);
    const lines = stdout.trimEnd().split("\n");
    const errors = lines.filter((line) => line.startsWith("::error::"));
    const context = `${JSON.stringify(title)}: ${stdout}${stderr}`;
    assert.equal(status, patterns.length === 0 ? 0 : 1, context);
    assert.equal(errors.length, patterns.length, context);
    patterns.forEach((pattern, i) => assert.match(errors[i], pattern, context));
    // Untrusted text must never start a workflow command of its own or leave a legacy `##[` marker on a bare line.
    assert.ok(lines.every((line) => line === "The PR title is valid." || line.startsWith("::error::")), context);
  }
  const notFound = await run(`${server.url}missing`);
  assert.equal(notFound.status, 1);
  assert.match(notFound.stdout, /^::error::Failed to fetch the pull request \(404\)/);
  const notPullRequest = await run("");
  assert.equal(notPullRequest.status, 1);
  assert.match(notPullRequest.stdout, /^::error::This workflow must be triggered by a pull_request/);
  console.log(`Semantic PR workflow judges ${cases.length} PR titles as expected.`);
} finally {
  server.stop(true);
  await fs.rm(root, { recursive: true, force: true });
}
