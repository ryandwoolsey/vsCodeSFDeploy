# sf-deploy-tools

Install **Cmd+Shift+D** deployment of the active saved Salesforce source file in VS Code. Built for macOS and Salesforce CLI (`sf`). No Salesforce extension or deployment service is added.

## Requirements

- macOS, VS Code, Node.js 20+ with npm, Git, and Salesforce CLI (`sf`).
- A Salesforce DX project containing `sfdx-project.json`.
- An authenticated Salesforce org configured as the project's default target-org.

Check your tools in Terminal:

```bash
node --version
npm --version
git --version
sf --version
```

## 1. Try the downloaded source locally

Extract the ZIP, open Terminal and change into its `sf-deploy-tools` directory:

```bash
cd ~/Downloads/sf-deploy-tools
npm ci
npm test
npm install -g .
sf-deploy-tools --help
```

The local install links to this directory, so keep it in place until you install from GitHub instead. If you save it elsewhere, adjust the `cd` path. Do not use `sudo`; if your npm global directory is not writable, use your normal Node version manager setup or run the CLI with `node /path/to/sf-deploy-tools/bin/sf-deploy-tools.cjs init` instead.

## 2. Create your GitHub repository

Create an empty repository called **sf-deploy-tools** on GitHub. Public or private both work; a private repository requires Git authentication on each Mac. Leave GitHub's README, .gitignore and license initialization unchecked because these files are included here.

In the extracted source directory, replace `YOUR_USERNAME` below with your GitHub username:

```bash
git init -b main
git add .
git commit -m "Add Salesforce deployment shortcut installer"
git remote add origin https://github.com/YOUR_USERNAME/sf-deploy-tools.git
git push -u origin main
```

`node_modules/` is excluded by the included `.gitignore`. This repository contains no org credentials or project-specific org configuration.

## 3. Install from GitHub once per Mac

After pushing the repo:

```bash
npm install -g github:YOUR_USERNAME/sf-deploy-tools
```

No npm registry account or npm publish step is needed. For a private repository with SSH authentication configured, you can use:

```bash
npm install -g 'git+ssh://git@github.com/YOUR_USERNAME/sf-deploy-tools.git'
```

## 4. Initialize each Salesforce project

In VS Code, open your Salesforce project folder, then open its integrated terminal:

```bash
sf-deploy-tools init
sf config get target-org
```

If needed, set the project's default to an org you have already authenticated:

```bash
sf config set target-org=YOUR_ORG_ALIAS
sf org display
```

Save your Salesforce source file and press **Cmd+Shift+D** while its editor has focus. The task terminal shows the full deployment result. A macOS notification reports confirmed success, failure, or a pending deployment. VS Code normally picks up tasks and keybindings immediately; if it does not, run **Developer: Reload Window** from the Command Palette.

You can also initialize a project from another directory:

```bash
sf-deploy-tools init "/Users/you/Documents/Salesforce/My Project"
```

The project path must contain `sfdx-project.json` directly. For a multi-root workspace, initialize each Salesforce folder. The task uses the folder of the selected file; if VS Code asks which folder's task to run, choose that folder. Keeping one Salesforce project per window is simplest.

## What init creates or updates

| File | Behavior |
| --- | --- |
| `<project>/.vscode/tasks.json` | Adds or updates only `Deploy current file with notification`; other tasks and inputs remain |
| `<project>/.vscode/sf-deploy-tools/deploy-current-file.cjs` | Installs the standalone deployment runner |
| `~/Library/Application Support/Code/User/keybindings.json` | Adds or updates Cmd+Shift+D for that task; other bindings remain |

- Supports JSON with comments and trailing commas. Unrelated comments and settings are retained by targeted JSONC edits. Comments inside the deployment task being replaced may be replaced along with that task.
- Invalid JSON/JSONC or duplicate matching task labels stop initialization before file changes.
- Every existing file whose contents change gets a timestamped `.sf-deploy-tools-...bak` sibling before writing. Backups are for local recovery; avoid committing them.
- Running init again leaves already-current files alone.
- Existing user shortcuts are preserved. Cmd+Shift+D replaces VS Code's normal Run and Debug shortcut in editor context. If you have another custom binding using it, inspect **Preferences: Open Keyboard Shortcuts (JSON)** to resolve precedence.
- Does not log in, change org settings, deploy during initialization, install Salesforce CLI, or change source code.
- The runner uses `sf project deploy start --source-dir <source> --json --wait 10`. Existing conflict checks and Salesforce's default test behavior remain in effect. LWC/Aura files deploy their complete bundle.
- If the deployment is still pending after the wait, the terminal supplies a report command. A pending job is not reported as successful; the task exits nonzero so it cannot be mistaken for completion.
- The runner uses Node's built-ins only. After initialization, deployment does not depend on this CLI package or on a node_modules folder in the Salesforce project.
- Save your file before invoking the shortcut. Deployments use the file on disk.

## Preview or customize setup

```bash
# Show intended file changes without writing anything
sf-deploy-tools init --dry-run

# Only install project files; leave global keybindings alone
sf-deploy-tools init --no-keybinding

# VS Code Insiders or a named profile: use its actual user-settings directory
sf-deploy-tools init --user-dir "/path/to/the/profile/settings-directory"
```

To locate a named profile's folder, activate that profile in VS Code, open **Preferences: Open Keyboard Shortcuts (JSON)**, and use the parent directory of that file for `--user-dir`. For VS Code Insiders on macOS, the default User folder is `~/Library/Application Support/Code - Insiders/User`.

Linux user settings are also recognized, and initialization uses Ctrl+Shift+D there. macOS notification delivery requires that macOS permits notifications from the application running AppleScript; no notification configuration is changed. Windows deployment execution is not supported by this version.

## Update later

Commit and push your changes in the tool repository. On each Mac, reinstall the latest GitHub version:

```bash
npm install -g github:YOUR_USERNAME/sf-deploy-tools
```

Then rerun `sf-deploy-tools init` in each Salesforce project to refresh its copied runner/task. Installing a new CLI version alone does not rewrite other project folders.

## Recovery and removal

To undo an update, close the affected JSON editor tabs and restore the corresponding timestamped backup to the original filename. To remove a fresh installation manually, delete the task named `Deploy current file with notification`, its matching keybinding, and `.vscode/sf-deploy-tools/`. Preserve other tasks and shortcuts. Remove the global CLI with:

```bash
npm uninstall -g sf-deploy-tools
```

Uninstalling the global CLI does not remove project files or shortcuts.

## Validation

```bash
npm ci
npm run check
npm test
npm pack --dry-run
```

Tests use temporary project/user folders and a mock Salesforce CLI. They cover JSONC merging, backups, reruns, original task migration, malformed settings, dry runs, rollback, paths with spaces/shell characters, LWC bundles, failure/pending handling and project boundary checks. No real org deployment is performed by the tests. Live macOS notifications and VS Code keyboard interaction should be checked on your Mac after initialization.

Implementation references:
- https://docs.npmjs.com/cli/v11/configuring-npm/package-json#bin
- https://docs.npmjs.com/cli/v11/commands/npm-install
- https://github.com/microsoft/node-jsonc-parser
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_start.html
