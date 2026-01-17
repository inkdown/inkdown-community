import { basename } from 'node:path';

const PLUGINS_FILE = 'plugins.json';
const THEMES_FILE = 'themes.json';
const MAIN_BRANCH = 'origin/main';

function runGitCommand(args) {
  try {
    const proc = Bun.spawnSync(['git', ...args]);
    return proc.stdout.toString().trim();
  } catch (error) {
    return null;
  }
}

async function getJson(content) {
  try {
    if (!content) return [];
    return JSON.parse(content);
  } catch (e) {
    console.error('Failed to parse JSON content:', e.message);
    return [];
  }
}

async function checkUrlExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function getModifiedItems(filePath) {
  if (!(await Bun.file(filePath).exists())) return [];

  const currentContent = await Bun.file(filePath).text();
  const currentItems = await getJson(currentContent);

  const mainContent = runGitCommand(['show', `${MAIN_BRANCH}:${filePath}`]);

  if (!mainContent) return currentItems;

  const mainItems = await getJson(mainContent);

  return currentItems.filter(item => {
    const old = mainItems.find(oldItem => oldItem.id === item.id);
    return !old || old.version !== item.version;
  });
}

function getAssetUrl(repo, version, filename) {
  let cleanRepo = repo.replace('https://github.com/', '').replace('http://github.com/', '');
  if (cleanRepo.endsWith('/')) cleanRepo = cleanRepo.slice(0, -1);

  return `https://github.com/${cleanRepo}/releases/download/${version}/${filename}`;
}

async function validatePluginRelease(plugin) {
  console.log(`Validating Plugin Release: ${plugin.name} v${plugin.version}...`);

  if (!plugin.version) {
    console.error(`  [ERROR] Plugin ${plugin.id} is missing 'version'.`);
    return false;
  }

  const versionsToTry = [plugin.version];
  if (!plugin.version.startsWith('v')) versionsToTry.push(`v${plugin.version}`);

  let baseUrl = null;
  let foundVersion = null;

  for (const v of versionsToTry) {
    const url = getAssetUrl(plugin.repo, v, 'main.js');
    if (await checkUrlExists(url)) {
      baseUrl = getAssetUrl(plugin.repo, v, '');
      foundVersion = v;
      break;
    }
  }

  if (!baseUrl) {
    console.error(`  [ERROR] Could not find 'main.js' release asset for ${plugin.repo} @ ${plugin.version} (checked ${versionsToTry.join(', ')})`);
    console.error(`          Ensure the release exists and contains 'main.js'.`);
    return false;
  }

  console.log(`  Found release asset 'main.js' at tag ${foundVersion}`);

  const manifestUrl = `${baseUrl}manifest.json`;
  const manifest = await fetchJson(manifestUrl);

  if (!manifest) {
    console.error(`  [ERROR] Missing 'manifest.json' in release assets.`);
    return false;
  }

  let manifestValid = true;
  if (manifest.id !== plugin.id) {
    console.error(`  [ERROR] Manifest 'id' mismatch. Registry: ${plugin.id}, Manifest: ${manifest.id}`);
    manifestValid = false;
  }
  if (manifest.version !== plugin.version) {
    console.error(`  [ERROR] Manifest 'version' mismatch. Registry: ${plugin.version}, Manifest: ${manifest.version}`);
    manifestValid = false;
  }

  const stylesUrl = `${baseUrl}styles.css`;
  if (await checkUrlExists(stylesUrl)) {
    console.log(`  Found 'styles.css' (optional).`);
  }

  return manifestValid;
}

async function validateThemeRelease(theme) {
  console.log(`Validating Theme Release: ${theme.name} v${theme.version}...`);

  if (!theme.version) {
    console.error(`  [ERROR] Theme ${theme.id} is missing 'version'.`);
    return false;
  }

  const versionsToTry = [theme.version];
  if (!theme.version.startsWith('v')) versionsToTry.push(`v${theme.version}`);

  let baseUrl = null;
  let foundVersion = null;

  for (const v of versionsToTry) {
    const url = getAssetUrl(theme.repo, v, 'theme.json');
    if (await checkUrlExists(url)) {
      baseUrl = getAssetUrl(theme.repo, v, '');
      foundVersion = v;
      break;
    }
  }

  if (!baseUrl) {
    console.error(`  [ERROR] Could not find 'theme.json' release asset for ${theme.repo} @ ${theme.version}`);
    return false;
  }

  console.log(`  Found release asset 'theme.json' at tag ${foundVersion}`);

  let cssValid = true;
  const modes = theme.modes || ['dark'];

  if (modes.includes('dark')) {
    const darkUrl = `${baseUrl}dark.css`;
    if (!(await checkUrlExists(darkUrl))) {
      console.error(`  [ERROR] Theme supports 'dark' mode but missing 'dark.css' in release.`);
      cssValid = false;
    } else {
      console.log(`  Found 'dark.css'.`);
    }
  }

  if (modes.includes('light')) {
    const lightUrl = `${baseUrl}light.css`;
    if (!(await checkUrlExists(lightUrl))) {
      console.error(`  [ERROR] Theme supports 'light' mode but missing 'light.css' in release.`);
      cssValid = false;
    } else {
      console.log(`  Found 'light.css'.`);
    }
  }

  return cssValid;
}


async function main() {
  console.log('Starting Inkdown Release Validator (Bun)...\n');

  if (!(await Bun.file('package.json').exists())) {
    if (await Bun.file(basename(PLUGINS_FILE)).exists()) {
      process.chdir('../..');
    }
  }

  const modifiedPlugins = await getModifiedItems(PLUGINS_FILE);
  const modifiedThemes = await getModifiedItems(THEMES_FILE);

  const args = process.argv.slice(2);
  const checkPlugins = args.length === 0 || args.includes('plugins');
  const checkThemes = args.length === 0 || args.includes('themes');

  const pluginsToValidate = checkPlugins ? modifiedPlugins : [];
  const themesToValidate = checkThemes ? modifiedThemes : [];

  if (pluginsToValidate.length === 0 && themesToValidate.length === 0) {
    console.log('No plugin/theme version changes detected or selected for validation. Skipping release validation.');
    process.exit(0);
  }

  let allValid = true;

  if (checkPlugins && modifiedPlugins.length > 0) {
    console.log(`\nChecking ${modifiedPlugins.length} modified plugins...`);
    for (const plugin of modifiedPlugins) {
      const valid = await validatePluginRelease(plugin);
      if (!valid) allValid = false;
    }
  }

  if (checkThemes && modifiedThemes.length > 0) {
    console.log(`\nChecking ${modifiedThemes.length} modified themes...`);
    for (const theme of modifiedThemes) {
      const valid = await validateThemeRelease(theme);
      if (!valid) allValid = false;
    }
  }

  if (!allValid) {
    console.error('\nRelease Validation FAILED.');
    process.exit(1);
  } else {
    console.log('\nAll checked releases are valid!');
    process.exit(0);
  }
}

main();
