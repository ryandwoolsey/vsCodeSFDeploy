#!/usr/bin/env node
'use strict';
// Installed by sf-deploy-tools. Uses only Node.js built-ins, so the project
// does not need node_modules or a global sf-deploy-tools installation to deploy.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function notify(message, success) {
  if (process.platform !== 'darwin') return;
  const script = 'on run argv\n display notification (item 1 of argv) with title (item 2 of argv)\nend run';
  try {
    spawnSync('/usr/bin/osascript', ['-e', script, message, success ? 'Salesforce deploy succeeded' : 'Salesforce deployment'], { encoding: 'utf8' });
  } catch { /* Notification availability must never change the deployment result. */ }
}
function main() {
  const root = fs.realpathSync(process.cwd());
  if (!fs.existsSync(path.join(root, 'sfdx-project.json'))) throw new Error('Run this task from the Salesforce project root.');
  const input = process.argv[2];
  if (!input || input.includes('${')) throw new Error('Open and save a Salesforce source file before running this task.');
  const file = fs.realpathSync(path.resolve(input));
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('The active file is outside this Salesforce project.');
  if (!fs.statSync(file).isFile()) throw new Error('The active source must be a file.');
  // A selected LWC/Aura source file deploys its complete metadata bundle.
  const parts = relative.split(path.sep);
  const bundle = parts.findIndex((part, i) => (part === 'lwc' || part === 'aura') && i < parts.length - 2);
  const source = bundle >= 0 ? path.join(root, ...parts.slice(0, bundle + 2)) : file;
  console.log(`[${new Date().toLocaleString()}] Deploying: ${path.relative(root, source)}`);
  console.log('Target: project Salesforce CLI default target-org');
  const result = spawnSync('sf', ['project', 'deploy', 'start', '--source-dir', source, '--json', '--wait', '10'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw new Error(`Could not run Salesforce CLI: ${result.error.message}. Ensure sf is installed and available to VS Code.`);
  if (result.stderr?.trim()) console.error(result.stderr.trim());
  let data;
  try { data = JSON.parse(result.stdout); }
  catch {
    if (result.stdout) console.log(result.stdout);
    throw new Error(`Salesforce CLI returned no valid JSON deployment result (exit ${result.status}). Review the output above.`);
  }
  // Keep the full CLI result available in the task terminal, including component errors.
  console.log(JSON.stringify(data, null, 2));
  const deployment = data.result || {};
  const success = result.status === 0 && data.status === 0 && deployment.done === true && deployment.success === true;
  if (success) {
    console.log(`[${new Date().toLocaleString()}] Deployment succeeded.`);
    notify(path.basename(source), true);
    return 0;
  }
  if (deployment.id && deployment.done === false) {
    console.error(`Deployment is still pending. Check it with: sf project deploy report --job-id ${deployment.id}`);
    notify('Deployment pending. Check the task terminal for its job ID.', false);
  } else {
    console.error(`[${new Date().toLocaleString()}] Deployment failed. See the Salesforce CLI result above.`);
    notify(`Failed: ${path.basename(source)}. See the task terminal.`, false);
  }
  return result.status || 1;
}
try { process.exitCode = main(); }
catch (error) { console.error(`Error: ${error.message}`); notify(error.message, false); process.exitCode = 1; }
