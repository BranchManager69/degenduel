import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/*
// In production, use absolute path from environment
const PROJECT_ROOT = process.env.PROJECT_ROOT || 
  (process.env.NODE_ENV === 'production' 
    ? '/home/websites/degenduel'
    : join(__dirname, '..', '..'));
const SERVER_ROOT = join(PROJECT_ROOT, 'server'); 
*/
const PROJECT_ROOT = join(__dirname, '..');
console.log('PROJECT_ROOT', PROJECT_ROOT);

/*
// Ensure all paths are absolute
const paths = {
  root: PROJECT_ROOT,
  server: SERVER_ROOT,
  logs: process.env.LOG_DIR || join(SERVER_ROOT, 'logs'),
  data: process.env.DATA_DIR || join(SERVER_ROOT, 'data'),
  public: join(PROJECT_ROOT, 'public'),
  dist: join(PROJECT_ROOT, 'dist')
};
*/
const paths = {
  logs: join(PROJECT_ROOT, 'logs')
};

// Create directories if they don't exist
for (const [key, path] of Object.entries(paths)) {
  try {
    if (!path.includes('node_modules')) {
      fs.mkdirSync(path, { recursive: true, mode: 0o755 });
    }
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.error(`Failed to create ${key} directory:`, error);
    }
  }
}

// Log paths in development
if (process.env.NODE_ENV !== 'production') {
  console.log('Paths configuration:', paths);
}

export default paths;