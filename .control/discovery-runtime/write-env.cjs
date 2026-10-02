const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-disc-'));
const env = [
  'DENTAI_DATA_DIR=' + dir,
  'DENTAI_ALLOW_FILE_STORAGE=true',
  'NODE_ENV=staging',
  'PORT=4731',
  'DENTAI_DETERMINISTIC_PROVIDER=true'
].join('\n');
fs.writeFileSync(path.join(dir, 'discovery.env'), env);
console.log(dir);
