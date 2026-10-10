import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workflow = Bun.YAML.parse(fs.readFileSync(".github/workflows/deploy.yml", "utf8"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-shell-"));
try {
  const startup = path.join(root, "startup.sh");
  fs.writeFileSync(startup, 'export PATH=/usr/bin:/bin\n');
  const expectedPath = `${root}:${process.env.PATH}`;
  const inheritedEnv = { ...process.env, PATH: expectedPath, BASH_ENV: startup, ENV: startup };
  const overrides = Object.fromEntries(
    Object.entries(workflow.jobs.deploy.env).filter(([key]) => key === "BASH_ENV" || key === "ENV"),
  );
  const result = spawnSync("/bin/bash", ["-c", 'printf "%s" "$PATH"'], {
    env: { ...inheritedEnv, ...overrides },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expectedPath, "Deployment shells must preserve the workflow PATH");
  console.info("Deployment shell preserves PATH with inherited startup files.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
