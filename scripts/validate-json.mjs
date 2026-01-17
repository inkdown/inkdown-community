const FILES_TO_VALIDATE = [
  {
    path: 'plugins.json',
    schema: ['id', 'name', 'author', 'version', 'description', 'repo'],
  },
  {
    path: 'themes.json',
    schema: ['id', 'name', 'author', 'version', 'description', 'repo', 'modes'],
    optional: ['homepage', 'screenshot'],
  }
];

function checkIndentation(content, filePath) {
  const lines = content.split('\n');
  let lineNum = 0;
  for (const line of lines) {
    lineNum++;
    if (line.trim().length === 0) continue;

    const leadingSpaces = line.match(/^ */)[0].length;

    if (leadingSpaces % 2 !== 0) {
      console.error(`[ERROR] ${filePath}:${lineNum} - Indentation must be a multiple of 2 spaces.`);
      return false;
    }
  }

  if (!content.endsWith('\n')) {
    console.error(`[ERROR] ${filePath} - File must end with a newline.`);
    return false;
  }


  try {
    const parsed = JSON.parse(content);
    const expected = JSON.stringify(parsed, null, 2) + '\n';
    if (content !== expected) {

      if (content.trim() !== expected.trim()) {
        console.error(`[ERROR] ${filePath} - JSON formatting is incorrect. Please use 2-space indentation.`);
        return false;
      }
    }
  } catch (e) {
  }

  return true;
}

async function validateFile(config) {
  const file = Bun.file(config.path);
  const fileName = config.path.split('/').pop();

  console.log(`Validating ${fileName}...`);

  if (!(await file.exists())) {
    console.error(`[ERROR] File not found: ${config.path}`);
    return false;
  }

  const content = await file.text();

  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    console.error(`[ERROR] Invalid JSON in ${fileName}: ${e.message}`);
    return false;
  }

  if (!Array.isArray(data)) {
    console.error(`[ERROR] Root element in ${fileName} must be an array.`);
    return false;
  }

  let isValid = true;

  if (!checkIndentation(content, config.path)) {
    isValid = false;
  }

  const ids = new Set();

  data.forEach((item, index) => {
    config.schema.forEach(field => {
      if (!item.hasOwnProperty(field)) {
        console.error(`[ERROR] Item at index ${index} missing required field: "${field}"`);
        isValid = false;
      } else if (typeof item[field] === 'string' && item[field].trim() === '') {
        console.error(`[ERROR] Item at index ${index} has empty field: "${field}"`);
        isValid = false;
      }
    });

    if (item.id) {
      if (ids.has(item.id)) {
        console.error(`[ERROR] Duplicate ID found: "${item.id}"`);
        isValid = false;
      }
      ids.add(item.id);
    }
  });

  return isValid;
}

async function main() {
  console.log('Starting Inkdown JSON Validator...\n');

  if (!(await Bun.file('package.json').exists())) {
    console.warn('Warning: Not running from root? package.json not found.');
  }

  let allValid = true;

  const args = process.argv.slice(2);
  let filesToCheck = FILES_TO_VALIDATE;

  if (args.length > 0) {
    filesToCheck = FILES_TO_VALIDATE.filter(config => {
      const fileName = config.path.split('/').pop();
      return args.includes(fileName);
    });
  }

  if (filesToCheck.length === 0) {
    console.log('No matching files to validate.');
    process.exit(0);
  }

  for (const config of filesToCheck) {
    const result = await validateFile(config);
    if (!result) {
      allValid = false;
    }
    console.log('');
  }

  if (!allValid) {
    console.error('JSON Validation FAILED.');
    process.exit(1);
  } else {
    console.log('All JSON files are valid!');
    process.exit(0);
  }
}

main();
