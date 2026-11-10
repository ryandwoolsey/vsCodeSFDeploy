#!/usr/bin/env node
'use strict';
// Standalone runner installed by sf-deploy-tools. No project npm dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const WAIT_MINUTES = 10;
function notify(message, success) {
  if (process.platform !== 'darwin') return;
  const script = 'on run argv\n display notification (item 1 of argv) with title (item 2 of argv)\nend run';
  try {
    spawnSync('/usr/bin/osascript', ['-e', script, message, success ? 'Deployed successfully' : 'Salesforce deployment'], { encoding: 'utf8' });
  } catch { /* Notification availability must not change deployment results. */ }
}
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
function runDeploy(root, source) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn('sf', ['project', 'deploy', 'start', '--source-dir', source, '--json', '--wait', String(WAIT_MINUTES)], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', totalBytes = 0, overflow = false;
    const paint = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const remaining = Math.max(0, WAIT_MINUTES * 60 - elapsed);
      const line = `Deploying ${path.basename(source)} | Elapsed ${clock(elapsed)} | CLI wait remaining ${clock(remaining)}`;
      if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${line}`);
      else if (elapsed === 0 || elapsed % 15 === 0) console.log(line);
    };
    paint();
    const timer = setInterval(paint, 1000);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(timer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
    };
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    const collect = (chunk, isError) => {
      totalBytes += chunk.length;
      if (totalBytes > 32 * 1024 * 1024) { overflow = true; child.kill(); return; }
      if (isError) stderr += chunk; else stdout += chunk;
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => collect(chunk, false));
    child.stderr.on('data', chunk => collect(chunk, true));
    child.once('error', error => {
      cleanup();
      reject(new Error(`Could not run Salesforce CLI: ${error.message}. Ensure sf is available to VS Code.`));
    });
    child.once('close', (status, signal) => {
      cleanup();
      if (overflow) return reject(new Error('CLI output exceeded 32 MB. Check Salesforce Deployment Status.'));
      if (signal) return reject(new Error(`CLI stopped (${signal}); the server deployment may still be running. Check Salesforce Deployment Status.`));
      resolve({ status, stdout, stderr, seconds: Math.floor((Date.now() - start) / 1000) });
    });
  });
}
async function main() {
  const root = fs.realpathSync(process.cwd());
  if (!fs.existsSync(path.join(root, 'sfdx-project.json'))) throw new Error('Run this task from the Salesforce project root.');
  const input = process.argv[2];
  if (!input || input.includes('${')) throw new Error('Open and save a Salesforce source file before running this task.');
  const file = fs.realpathSync(path.resolve(input));
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('The active file is outside this Salesforce project.');
  if (!fs.statSync(file).isFile()) throw new Error('The active source must be a file.');
  const parts = relative.split(path.sep);
  const bundle = parts.findIndex((part, i) => (part === 'lwc' || part === 'aura') && i < parts.length - 2);
  const source = bundle >= 0 ? path.join(root, ...parts.slice(0, bundle + 2)) : file;
  const result = await runDeploy(root, source);
  let data;
  try { data = JSON.parse(result.stdout); }
  catch {
    if (result.stderr.trim()) console.error(result.stderr.trim());
    if (result.stdout) console.log(result.stdout);
    throw new Error(`No valid JSON deployment result (exit ${result.status}). Review the output above.`);
  }
  const deployment = data.result || {};
  const success = result.status === 0 && data.status === 0 && deployment.done === true && deployment.success === true;
  if (success) {
    console.log(`Deployment succeeded. ${path.basename(source)} | ${clock(result.seconds)}`);
    // Retain useful warnings without repeating the known registry noise/update banner.
    const warnings = [...new Set(data.warnings || [])].filter(w => !String(w).includes('Unable to find type GenOpAgentConfig in registry'));
    for (const warning of warnings) console.warn(`Warning: ${warning}`);
    const stderr = result.stderr.split(/\r?\n/).filter(line => line.trim() && !line.includes('@salesforce/cli update available') && !line.includes('Unable to find type GenOpAgentConfig in registry')).join('\n');
    if (stderr) console.error(stderr);
    notify(`${path.basename(source)} — ${clock(result.seconds)}`, true);
    return 0;
  }
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (deployment.id && deployment.done === false) {
    console.error(`Deployment still pending after ${clock(result.seconds)}.\nCheck: sf project deploy report --job-id ${deployment.id}`);
    notify('Deployment pending. See the task terminal for its job ID.', false);
  } else {
    console.error(JSON.stringify(data, null, 2));
    console.error(`Deployment failed after ${clock(result.seconds)}. See details above.`);
    notify(`Failed: ${path.basename(source)}. See the task terminal.`, false);
  }
  return result.status || 1;
}
main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`Error: ${error.message}`);
  notify(error.message, false);
  process.exitCode = 1;
});
