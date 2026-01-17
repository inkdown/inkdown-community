import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const ALLOWED_EXTENSIONS = ['.ts', '.js', '.json', '.md', '.css', '.png', '.jpg', '.jpeg', '.svg', '.gitignore', '.ym', '.yaml', 'yml', '.mjs'];

const FORBIDDEN_TOKENS = [
  { token: 'window.', message: 'Direct access to "window" is forbidden. Use platform-agnostic abstractions.' },
  { token: 'document.', message: 'Direct access to "document" is forbidden. Use platform-agnostic abstractions.' },
  { token: 'innerHTML', message: 'Usage of "innerHTML" is forbidden.' },
  { token: 'outerHTML', message: 'Usage of "outerHTML" is forbidden.' },
  { token: '@codemirror/', message: 'Direct imports from "@codemirror/" are forbidden. Use @inkdown/core editor abstractions.' },
  { token: '@tauri-apps/', message: 'Direct imports from "@tauri-apps/" are forbidden. Use @inkdown/core native abstractions.' },
];

const PLUGINS_FILE = 'apps/inkdown-community/plugins.json';
const MAIN_BRANCH = 'origin/main';

function runCommand(command, args, cwd) {
  try {
    const proc = Bun.spawnSync([command, ...args], { cwd });
    return proc.stdout.toString().trim();
  } catch (error) {
    return null;
  }
}

async function getPlugins(content) {
  try {
    return JSON.parse(content);
  } catch (e) {
    console.error('Failed to parse plugins.json:', e.message);
    return [];
  }
}

async function validatePlugin(plugin) {
  console.log(`\nValidating plugin: ${plugin.name} (${plugin.repo})...`);

  const tempDir = mkdtempSync(join(tmpdir(), 'inkdown-validator-'));

  try {
    console.log(`  Cloning ${plugin.repo}...`);
    runCommand('git', ['clone', '--depth', '1', plugin.repo, tempDir]);

    let hasErrors = false;

    const glob = new Bun.Glob('**/*');

    for (const file of glob.scanSync({ cwd: tempDir, absolute: false })) {
      if (file.startsWith('.git/')) continue;

      const absolutePath = join(tempDir, file);

      const ext = extname(file).toLowerCase();

      if (!ALLOWED_EXTENSIONS.includes(ext) && basename(file) !== 'LICENSE' && basename(file) !== 'README') {
        console.error(`  [ERROR] Forbidden file type found: ${file} (Extension "${ext}" is not in whitelist)`);
        hasErrors = true;
        continue;
      }

      if (['.ts', '.js'].includes(ext)) {
        const content = await Bun.file(absolutePath).text();
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          FORBIDDEN_TOKENS.forEach(({ token, message }) => {
            if (line.includes(token)) {
              if (!line.trim().startsWith('//') && !line.trim().startsWith('*')) {
                console.error(`  [ERROR] Forbidden token "${token}" found in ${file}:${index + 1}`);
                console.error(`          ${message}`);
                hasErrors = true;
              }
            }
          });
        });
      }
    }

    return !hasErrors;

  } catch (e) {
    console.error(`  [FATAL] Error validating plugin: ${e.message}`);
    console.error(e);
    return false;
  } finally {
    runCommand('rm', ['-rf', tempDir]);
  }
}

async function main() {
  console.log('Starting Inkdown Plugin Validator (Bun Native)...');

  if (!(await Bun.file(PLUGINS_FILE).exists()) && (await Bun.file(basename(PLUGINS_FILE)).exists())) {
    process.chdir('../..');
  }

  if (!(await Bun.file(PLUGINS_FILE).exists())) {
    console.error(`Could not find ${PLUGINS_FILE}. Run from repository root.`);
    process.exit(1);
  }

  const currentContent = await Bun.file(PLUGINS_FILE).text();
  const currentPlugins = await getPlugins(currentContent);

  let diffPlugins = [];

  const proc = Bun.spawnSync(['git', 'show', `${MAIN_BRANCH}:${PLUGINS_FILE}`]);
  const mainContent = proc.stdout.toString().trim();

  if (!mainContent || proc.exitCode !== 0) {
    console.warn(`Could not retrieve ${PLUGINS_FILE} from ${MAIN_BRANCH}. Assuming all plugins need validation.`);
    diffPlugins = currentPlugins;
  } else {
    const mainPlugins = await getPlugins(mainContent);
    diffPlugins = currentPlugins.filter(p => {
      const old = mainPlugins.find(mp => mp.id === p.id);
      return !old || old.repo !== p.repo;
    });
  }

  if (diffPlugins.length === 0) {
    console.log('No plugin changes detected.');
    process.exit(0);
  }

  console.log(`Found ${diffPlugins.length} modified/new plugins.`);

  let failure = false;
  for (const plugin of diffPlugins) {
    const isValid = await validatePlugin(plugin);
    if (!isValid) {
      failure = true;
    }
  }

  if (failure) {
    console.error('\nValidation FAILED. Please fix the errors above.');
    process.exit(1);
  } else {
    console.log('\nAll plugins successfully validated!');
    process.exit(0);
  }
}

main();
