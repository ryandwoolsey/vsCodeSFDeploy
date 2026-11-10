'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parse } = require('jsonc-parser');
const { install, LABEL } = require('../lib/install.cjs');

function fixture(t) {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sf-deploy-tools-'))
  );
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = path.join(base, 'Project with spaces');
  const userDir = path.join(base, 'VS Code User');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app","default":true}]}');
  return { base, project, userDir, options: { userDir, log() {} } };
}
function write(filename, text) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, text); }
const read = filename => fs.readFileSync(filename, 'utf8');

test('creates task, standalone runner and shortcut; second run changes nothing', t => {
  const f = fixture(t);
  const first = install(f.project, f.options);
  assert.equal(first.changes.length, 3);
  const task = parse(read(path.join(f.project, '.vscode/tasks.json'))).tasks[0];
  assert.equal(task.label, LABEL);
  assert.equal(task.type, 'process');
  assert.equal(task.options.cwd, '${workspaceFolder}');
  assert.equal(parse(read(path.join(f.userDir, 'keybindings.json')))[0].args, LABEL);
  assert.equal(install(f.project, f.options).changes.length, 0);
  assert.equal(fs.readdirSync(path.join(f.project, '.vscode')).filter(s => s.endsWith('.bak')).length, 0);
});

test('merges JSONC and trailing commas; retains other entries, comments and exact backups', t => {
  const f = fixture(t);
  const tasksPath = path.join(f.project, '.vscode/tasks.json');
  const keysPath = path.join(f.userDir, 'keybindings.json');
  const original = '// Keep this comment\n{"version":"2.0.0","tasks":[{"label":"Other","command":"echo hello"},],"inputs":[],}\n';
  write(tasksPath, original);
  write(keysPath, '// My shortcut\n[{"key":"cmd+k","command":"other"},]\n');
  install(f.project, f.options);
  const updated = read(tasksPath);
  assert(updated.includes('// Keep this comment'));
  assert.equal(parse(updated).tasks[0].command, 'echo hello');
  assert.deepEqual(parse(updated).inputs, []);
  assert.equal(parse(updated).tasks.length, 2);
  assert(read(keysPath).includes('// My shortcut'));
  assert.equal(parse(read(keysPath))[0].command, 'other');
  const backup = fs.readdirSync(path.dirname(tasksPath)).find(s => s.startsWith('tasks.json.sf-deploy-tools-'));
  assert.equal(read(path.join(path.dirname(tasksPath), backup)), original);
  assert.equal(install(f.project, f.options).changes.length, 0);
});

test('replaces original deployment task without duplicating old keybinding', t => {
  const f = fixture(t);
  const key = process.platform === 'darwin' ? 'cmd+shift+d' : 'ctrl+shift+d';
  write(path.join(f.project, '.vscode/tasks.json'), JSON.stringify({version:'2.0.0',tasks:[{label:LABEL,type:'shell',command:'old'}]}));
  write(path.join(f.userDir, 'keybindings.json'), JSON.stringify([{key,command:'workbench.action.tasks.runTask',args:LABEL,when:'editorTextFocus'}]));
  install(f.project, f.options);
  assert.equal(parse(read(path.join(f.project,'.vscode/tasks.json'))).tasks.length,1);
  assert.equal(parse(read(path.join(f.userDir,'keybindings.json'))).length,1);
  assert.equal(install(f.project, f.options).changes.length,0);
});

test('malformed keybindings stop all writes before tasks or runner change', t => {
  const f = fixture(t);
  write(path.join(f.userDir, 'keybindings.json'), '[{broken json]');
  assert.throws(() => install(f.project, f.options), /Invalid JSON/);
  assert(!fs.existsSync(path.join(f.project, '.vscode')));
});

test('dry run writes nothing; no-keybinding leaves user directory untouched', t => {
  const f = fixture(t);
  assert.equal(install(f.project, {...f.options,dryRun:true}).changes.length,3);
  assert(!fs.existsSync(path.join(f.project,'.vscode')));
  assert(!fs.existsSync(f.userDir));
  install(f.project,{...f.options,noKeybinding:true});
  assert(!fs.existsSync(f.userDir));
});

test('refuses non-projects and duplicate task labels', t => {
  const f = fixture(t);
  assert.throws(() => install(f.base,f.options),/sfdx-project/);
  write(path.join(f.project,'.vscode/tasks.json'),JSON.stringify({tasks:[{label:LABEL},{label:LABEL}]}));
  assert.throws(() => install(f.project,f.options),/Multiple tasks/);
  assert(!fs.existsSync(f.userDir));
});

test('blocked destination is caught before any writes', t => {
  const f = fixture(t);
  const taskPath = path.join(f.project,'.vscode/tasks.json');
  const original = '{"version":"2.0.0","tasks":[]}\n';
  write(taskPath,original);
  // A regular file blocks creation of the runner subdirectory, on any user/OS.
  write(path.join(f.project,'.vscode/sf-deploy-tools'),'blocking file');
  assert.throws(() => install(f.project,f.options), /ENOTDIR/);
  assert.equal(read(taskPath),original);
  assert(!fs.existsSync(f.userDir));
});

function runnerFixture(t, response, code = 0) {
  const f = fixture(t);
  install(f.project,{...f.options,noKeybinding:true});
  const bin = path.join(f.base,'bin'); fs.mkdirSync(bin);
  const mock = `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CAPTURE,JSON.stringify(process.argv.slice(2)));\nconsole.log(${JSON.stringify(JSON.stringify(response))});\nprocess.exit(${code});\n`;
  write(path.join(bin,'sf'),mock); fs.chmodSync(path.join(bin,'sf'),0o755);
  const capture = path.join(f.base,'args.json');
  const run = file => spawnSync(process.execPath,[path.join(f.project,'.vscode/sf-deploy-tools/deploy-current-file.cjs'),file],{
    cwd:f.project,encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,CAPTURE:capture}
  });
  return {...f,run,capture};
}

test('runner handles spaces and shell characters as literal file arguments', t => {
  const f = runnerFixture(t,{status:0,result:{done:true,success:true,status:'Succeeded'}});
  const file = path.join(f.project,'force-app/main/default/classes/Price $test.cls');
  write(file,'public class Price {}');
  const r = f.run(file);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/Deployment succeeded/);
  const args = JSON.parse(read(f.capture));
  assert.deepEqual(args,['project','deploy','start','--source-dir',file,'--json','--wait','10']);
});

test('runner deploys full LWC bundle', t => {
  const f = runnerFixture(t,{status:0,result:{done:true,success:true}});
  const file = path.join(f.project,'force-app/main/default/lwc/myWidget/myWidget.js');
  write(file,'export default class MyWidget {}');
  assert.equal(f.run(file).status,0);
  assert.equal(JSON.parse(read(f.capture))[4],path.dirname(file));
});

test('runner preserves failure and treats wait timeout as pending, never success', t => {
  for (const [data,code] of [
    [{status:1,name:'DeployFailed',message:'Compile error'},1],
    [{status:0,result:{done:false,id:'0AfExample'}},0],
    [{status:0,result:{done:true,success:false}},0]
  ]) {
    const f = runnerFixture(t,data,code);
    const file = path.join(f.project,'force-app/A.cls'); write(file,'x');
    const r = f.run(file);
    assert.notEqual(r.status,0);
    assert.doesNotMatch(r.stdout,/Deployment succeeded/);
    if (data.result?.done === false) assert.match(r.stderr,/sf project deploy report/);
  }
});

test('runner refuses files outside the project, including symlinks', t => {
  const f = runnerFixture(t,{status:0,result:{done:true,success:true}});
  const outside = path.join(f.base,'Outside.cls'); write(outside,'x');
  const link = path.join(f.project,'Inside.cls'); fs.symlinkSync(outside,link);
  assert.notEqual(f.run(link).status,0);
  assert(!fs.existsSync(f.capture));
});

 test('rolls back prior changes after a write failure', t => {
  const f = fixture(t);
  const taskPath = path.join(f.project,'.vscode/tasks.json');
  const original = '{"version":"2.0.0","tasks":[]}\n';
  write(taskPath, original);
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function(filename, ...args) {
    if (String(filename).endsWith('deploy-current-file.cjs')) throw new Error('Simulated disk failure');
    return originalWrite.call(this, filename, ...args);
  };
  try { assert.throws(() => install(f.project,f.options), /rolled back/); }
  finally { fs.writeFileSync = originalWrite; }
  assert.equal(read(taskPath), original);
  assert(!fs.existsSync(path.join(f.userDir,'keybindings.json')));
});
