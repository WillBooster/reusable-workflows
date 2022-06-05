const actions = require('./wbfy.temp.json');
for (const run of actions?.workflow_runs ?? []) {
  if (run.name !== 'Test') continue;
  if (run.head_branch !== 'wbfy') continue;

  if (run.status !== 'completed') break;
  if (run.conclusion === 'success') {
    console.log('merge');
  } else if (run.conclusion === 'failure') {
    console.log('pr');
  }
  break;
}
