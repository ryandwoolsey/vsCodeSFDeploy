#!/usr/bin/env node
'use strict';
const { install } = require('../lib/install.cjs');
const args = process.argv.slice(2);
const help = `Usage: sf-deploy-tools init [project-folder] [options]

Run from a Salesforce project root, or supply its path.

Options:
  --dry-run           Show changes without writing files
  --no-keybinding     Install project files only
  --user-dir PATH     VS Code user settings directory (e.g. a named profile)
  --help              Show this help

Default on macOS: ~/Library/Application Support/Code/User
Existing changed files receive timestamped backups. No deployment is run.
The project must contain sfdx-project.json. Its target org is not changed.`;
(async () => {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(help); return;
  }
  if (args.shift() !== 'init') throw new Error('Expected "init". Use --help for usage.');
  const options = {};
  let project;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-keybinding') options.noKeybinding = true;
    else if (arg === '--user-dir') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--user-dir requires a path.');
      options.userDir = args[++i];
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (project !== undefined) throw new Error('Supply only one project folder.');
    else project = arg;
  }
  install(project || process.cwd(), options);
})().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
