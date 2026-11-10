'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse, modify, applyEdits, printParseErrorCode } = require('jsonc-parser');
const LABEL = 'Deploy current file with notification';

function document(text, expected, filename) {
  const errors = [];
  const value = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true, allowEmptyContent: false });
  if (errors.length) {
    throw new Error(`Invalid JSON/JSONC in ${filename}: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}. No files changed.`);
  }
  if (expected === 'array' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${filename} must contain a JSON ${expected}. No files changed.`);
  }
  return value;
}
function edit(text, location, value) {
  // jsonc-parser updates only the requested location, retaining other entries/comments.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const result = applyEdits(text.replace(/^\uFEFF/, ''), modify(text.replace(/^\uFEFF/, ''), location, value, {
    formattingOptions: { insertSpaces: true, tabSize: 4, eol }
  }));
  return (text.startsWith('\uFEFF') ? '\uFEFF' : '') + result;
}
function defaultUserDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/Code/User');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'Code/User');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Code/User');
}
function readFile(filename, fallback) {
  try { return fs.readFileSync(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function install(project, options = {}) {
  const log = options.log || console.log;
  const root = fs.realpathSync(path.resolve(project));
  if (!fs.existsSync(path.join(root, 'sfdx-project.json'))) {
    throw new Error(`No sfdx-project.json in ${root}. Run from the Salesforce project root.`);
  }
  const tasksPath = path.join(root, '.vscode/tasks.json');
  const scriptPath = path.join(root, '.vscode/sf-deploy-tools/deploy-current-file.cjs');
  const task = {
    label: LABEL,
    type: 'process',
    command: 'node',
    args: ['${workspaceFolder}/.vscode/sf-deploy-tools/deploy-current-file.cjs', '${file}'],
    options: { cwd: '${workspaceFolder}' },
    problemMatcher: [],
    presentation: { reveal: 'always', panel: 'dedicated', clear: true, focus: false }
  };
  const changes = [];
  const previousTasks = readFile(tasksPath, '{}\n');
  let nextTasks = previousTasks;
  const tasksDoc = document(previousTasks, 'object', tasksPath);
  if (tasksDoc.version && tasksDoc.version !== '2.0.0') throw new Error('Unsupported tasks.json version. No files changed.');
  if (!tasksDoc.version) nextTasks = edit(nextTasks, ['version'], '2.0.0');
  if (tasksDoc.tasks !== undefined && !Array.isArray(tasksDoc.tasks)) throw new Error('tasks.json "tasks" must be an array. No files changed.');
  const tasks = tasksDoc.tasks || [];
  const matches = tasks.map((t, i) => t && t.label === LABEL ? i : -1).filter(i => i >= 0);
  if (matches.length > 1) throw new Error(`Multiple tasks named "${LABEL}". Remove duplicate tasks before installing. No files changed.`);
  if (!tasksDoc.tasks) nextTasks = edit(nextTasks, ['tasks'], [task]);
  else if (matches.length) {
    if (JSON.stringify(tasks[matches[0]]) !== JSON.stringify(task)) nextTasks = edit(nextTasks, ['tasks', matches[0]], task);
  } else nextTasks = edit(nextTasks, ['tasks', tasks.length], task);
  document(nextTasks, 'object', tasksPath);
  changes.push({ filename: tasksPath, content: nextTasks });
  changes.push({ filename: scriptPath, content: fs.readFileSync(path.join(__dirname, '../templates/deploy-current-file.cjs'), 'utf8') });

  if (!options.noKeybinding) {
    const keysPath = path.join(path.resolve(options.userDir || defaultUserDir()), 'keybindings.json');
    const oldKeys = readFile(keysPath, '[]\n');
    const keys = document(oldKeys, 'array', keysPath);
    const key = process.platform === 'darwin' ? 'cmd+shift+d' : 'ctrl+shift+d';
    const binding = { key, command: 'workbench.action.tasks.runTask', args: LABEL, when: 'editorTextFocus' };
    // Reuse the shortcut from the original setup; leave other user shortcuts intact.
    const match = keys.findIndex(k => k && k.key === key && k.command === binding.command && k.args === LABEL);
    let newKeys = oldKeys;
    if (match < 0) newKeys = edit(newKeys, [keys.length], binding);
    else if (JSON.stringify(keys[match]) !== JSON.stringify(binding)) newKeys = edit(newKeys, [match], binding);
    if (keys.some((k, i) => i !== match && k && k.key === key)) {
      log(`Note: another ${key} user shortcut exists. The deployment binding is retained/added; inspect Keyboard Shortcuts if it conflicts.`);
    }
    document(newKeys, 'array', keysPath);
    changes.push({ filename: keysPath, content: newKeys });
  }

  const pending = changes.filter(c => readFile(c.filename, null) !== c.content);
  log(`Project: ${root}`);
  if (options.dryRun) {
    for (const c of pending) log(`Would ${fs.existsSync(c.filename) ? 'update' : 'create'}: ${c.filename}`);
    if (!pending.length) log('Already installed; no changes needed.');
    return { changes: pending, dryRun: true };
  }
  const completed = [];
  try {
    for (const c of pending) {
      const existed = fs.existsSync(c.filename);
      const original = existed ? fs.readFileSync(c.filename) : null;
      const mode = existed ? fs.statSync(c.filename).mode : 0o644;
      const backup = existed ? `${c.filename}.sf-deploy-tools-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.bak` : null;
      fs.mkdirSync(path.dirname(c.filename), { recursive: true });
      if (backup) { fs.copyFileSync(c.filename, backup, fs.constants.COPYFILE_EXCL); log(`Backup: ${backup}`); }
      // Record before writing so even a partially failed write is rolled back.
      completed.push({ ...c, original, mode });
      fs.writeFileSync(c.filename, c.content, { mode });
      log(`${existed ? 'Updated' : 'Created'}: ${c.filename}`);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const c of completed.reverse()) {
      try {
        if (c.original === null) fs.rmSync(c.filename, { force: true });
        else fs.writeFileSync(c.filename, c.original, { mode: c.mode });
      } catch (restoreError) { rollbackErrors.push(`${c.filename}: ${restoreError.message}`); }
    }
    throw new Error(`${error.message}. ${rollbackErrors.length ? 'Restore these files from backups: ' + rollbackErrors.join('; ') : 'File changes rolled back; backups retained.'}`);
  }
  if (!pending.length) log('Already installed; no changes needed.');
  log('Ready. Save your source file, then press Cmd+Shift+D (Ctrl+Shift+D on other systems).');
  log('Uses the Salesforce CLI default target-org for this project; authentication and org settings are unchanged.');
  return { changes: pending, dryRun: false };
}
module.exports = { install, document, LABEL };
