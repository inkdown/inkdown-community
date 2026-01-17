const PLUGINS_FILE = 'plugins.json';
const THEMES_FILE = 'themes.json';
const MAIN_BRANCH = 'origin/main';

function runGitCommand(args) {
  try {
    const cmd = args[0] === 'gh' ? args : ['git', ...args];
    const proc = Bun.spawnSync(cmd);
    if (proc.exitCode !== 0) {
      console.error(`Git command failed: ${cmd.join(' ')}\nStderr: ${proc.stderr.toString()}`);
    }
    return proc.stdout.toString().trim();
  } catch (error) {
    console.error(`Git execution error: ${error.message}`);
    return '';
  }
}

function runScript(scriptPath, args = []) {
  console.log(`> Running ${scriptPath} ${args.join(' ')}`);
  const proc = Bun.spawnSync(['bun', scriptPath, ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  return proc.exitCode === 0;
}

async function main() {
  console.log('Starting Inkdown PR Orchestrator...\n');

  // Fetch main to ensure we have the reference
  console.log('Fetching origin main...');
  runGitCommand(['fetch', 'origin', 'main']);

  const headSha = runGitCommand(['rev-parse', 'HEAD']);
  const baseSha = runGitCommand(['rev-parse', 'origin/main']);
  console.log(`HEAD: ${headSha}`);
  console.log(`origin/main: ${baseSha}`);

  console.log(`Diffing origin/main...HEAD`);
  // Use 3-dot diff to find changes reachable from HEAD that are not in origin/main
  const diffOutput = runGitCommand(['diff', '--name-only', 'origin/main...HEAD']);

  if (!diffOutput && diffOutput !== '') {
    console.warn('Warning: git diff returned no output or failed (check logs if verbose).');
  } else {
    console.log('Git Diff Output:\n' + (diffOutput || '(empty)'));
  }
  const changedFiles = diffOutput.split('\n').map(s => s.trim()).filter(Boolean);

  const pluginsModified = changedFiles.some(f => f.includes(PLUGINS_FILE));
  const themesModified = changedFiles.some(f => f.includes(THEMES_FILE));

  console.log(`Modified: Plugins=${pluginsModified}, Themes=${themesModified}`);

  if (pluginsModified && themesModified) {
    console.error('\n[FATAL] "Exclusive PR" Rule Violation.');
    console.error('You cannot modify strictly both plugins.json and themes.json in the same PR.');
    console.error('Please split your changes into two separate Pull Requests.');
    process.exit(1);
  }

  if (!pluginsModified && !themesModified) {
    console.log('No registry files modified. Passing validation (assuming unrelated change like README).');
    process.exit(0);
  }

  let success = true;

  if (pluginsModified) {
    console.log('\n--- Validating Plugins ---');

    if (!runScript('scripts/validate-json.mjs', ['plugins.json'])) success = false;

    if (!runScript('scripts/validate-plugins.mjs')) success = false;

    if (!runScript('scripts/validate-releases.mjs', ['plugins'])) success = false;
  }

  if (themesModified) {
    console.log('\n--- Validating Themes ---');

    if (!runScript('scripts/validate-json.mjs', ['themes.json'])) success = false;

    if (!runScript('scripts/validate-releases.mjs', ['themes'])) success = false;
  }

  // 4. Labeling
  const prNumber = process.env.PR_NUMBER;
  if (prNumber) {
    console.log(`\n--- Labeling PR #${prNumber} ---`);
    const labelsToAdd = [];
    const labelsToRemove = [];

    // Type labels
    if (pluginsModified) labelsToAdd.push('plugin');
    if (themesModified) labelsToAdd.push('theme');

    // Status labels
    if (success) {
      labelsToAdd.push('waiting-for-review');
      labelsToRemove.push('validation-error');
    } else {
      labelsToAdd.push('validation-error');
      labelsToRemove.push('waiting-for-review');
    }

    // Apply labels
    if (labelsToAdd.length > 0) {
      console.log(`Adding labels: ${labelsToAdd.join(', ')}`);
      runGitCommand(['gh', 'pr', 'edit', prNumber, '--add-label', labelsToAdd.join(',')]);
    }

    if (labelsToRemove.length > 0) {
      console.log(`Removing labels: ${labelsToRemove.join(', ')}`);
      runGitCommand(['gh', 'pr', 'edit', prNumber, '--remove-label', labelsToRemove.join(',')]);
    }
  } else {
    console.log('\nSkipping labeling (Not in PR context or PR_NUMBER missing).');
  }

  if (!success) {
    console.error('\nValidation Suite FAILED.');
    process.exit(1);
  } else {
    console.log('\nValidation Suite Passed!');
    process.exit(0);
  }
}

main();
