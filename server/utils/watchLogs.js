import { spawn } from 'child_process';
import { join } from 'path';
import { Transform } from 'stream';
import paths from '../config/paths.js';

class JsonParseTransform extends Transform {
  constructor(options = {}) {
    super({ ...options, objectMode: true });
  }

  _transform(chunk, encoding, callback) {
    try {
      const line = chunk.toString().trim();
      if (!line) return callback();
      const parsed = JSON.parse(line);
      this.push(parsed);
    } catch (err) {
      // Silently skip invalid JSON
    }
    callback();
  }
}

class PrettyFormatTransform extends Transform {
  constructor(options = {}) {
    super({ ...options, objectMode: true });
  }

  _transform(chunk, encoding, callback) {
    try {
      const { timestamp, level, message, service, ...meta } = chunk;
      const serviceStr = service ? `[${service}] ` : '';
      const metaStr = Object.keys(meta).length ? 
        `\n  ${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')}` : '';
      
      this.push(`${timestamp} ${serviceStr}[${level.toUpperCase()}] ${message}${metaStr}\n`);
    } catch (err) {
      // Skip malformed entries
    }
    callback();
  }
}

export function watchLogs(type = 'all', lines = 50, pretty = true) {
  const today = new Date().toISOString().split('T')[0];
  const logFile = join(paths.logs, `${type}-${today}.log`);
  
  console.log('Watching:', logFile);

  // Create transform streams
  const jsonTransform = new JsonParseTransform();
  const prettyTransform = pretty ? new PrettyFormatTransform() : new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      this.push(JSON.stringify(chunk, null, 2) + '\n');
      callback();
    }
  });

  // First show recent logs
  const tail = spawn('tail', ['-n', lines.toString(), logFile]);
  tail.stdout.pipe(jsonTransform).pipe(prettyTransform).pipe(process.stdout);
  
  // Then follow new logs
  const follow = spawn('tail', ['-f', logFile]);
  follow.stdout.pipe(jsonTransform).pipe(prettyTransform).pipe(process.stdout);
  
  // Handle cleanup
  const cleanup = () => {
    tail.kill();
    follow.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Handle errors
  [tail, follow].forEach(proc => {
    proc.stderr.on('data', data => {
      console.error(`Error watching ${logFile}:`, data.toString());
    });
  });
}