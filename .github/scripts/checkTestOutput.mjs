import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const workflow = Bun.YAML.parse(await fs.readFile(".github/workflows/test.yml", "utf8"));
const script = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).find((step) => step.id === "test").run;
await fs.mkdir(".tmp", { recursive: true });
const root = await fs.mkdtemp(path.resolve(".tmp/test-output-"));
try {
  await fs.writeFile(path.join(root, "emit.cjs"), "require('node:fs').writeFileSync(1, 'evidence\\n'.repeat(100_000)); process.exit(Number(process.argv[2]));");
  const names = new Set();
  for (const command of ["test", "test/ci", "custom"]) {
    for (const code of [0, 7]) {
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { [command]: `node emit.cjs ${code}` } }));
      const outputPath = path.join(root, "outputs");
      await fs.writeFile(outputPath, "");
      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
        cwd: root,
        env: { ...process.env, HAS_TEST_COMMAND: String(command === "custom"), CUSTOM_TEST_COMMAND: command, RUNNER: "bun", RUNNER_TEMP: root, GITHUB_OUTPUT: outputPath },
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
      });
      assert.equal(result.status, code, result.stderr);
      const outputs = await fs.readFile(outputPath, "utf8");
      const logPath = outputs.match(/^log_path=(.+)$/m)[1];
      const name = outputs.match(/^artifact_name=(.+)$/m)[1];
      assert.ok(!names.has(name), "Artifact names collide between invocations");
      names.add(name);
      assert.equal((await fs.readFile(logPath, "utf8")).match(/evidence/g).length, 100_000);
      assert.equal(result.stdout.match(/evidence/g).length, 100_000);
    }
  }
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "printf '%4096s' x" } }));
  const limited = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", `ulimit -f 1\n${script}`], {
    cwd: root,
    env: { ...process.env, HAS_TEST_COMMAND: "false", RUNNER: "bun", RUNNER_TEMP: root, GITHUB_OUTPUT: path.join(root, "limited-outputs") },
    encoding: "utf8",
  });
  assert.notEqual(limited.status, 0, "A failed log write must fail successful tests");
  assert.match(limited.stderr, /File.*(size|limit)/i);
  console.log("Test workflow preserves complete logs and exit codes for default and custom commands.");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
