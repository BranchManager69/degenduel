import { spawn } from 'child_process';
import { Transform } from 'stream';
import { join } from 'path';
import fs from 'fs';

// Get log directory from environment or use default
const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'server', 'logs');

// Custom transform stream for JSON parsing and deduplication
class LogTransform extends Transform {
  constructor(options = {}) {
    super({ ...options, objectMode: true });
    this.seenMessages = new Set();
  }

  _transform(chunk, encoding, callback) {
    try {
      const line = chunk.toString().trim();
      if (!line) return callback();
      
      // Parse JSON and create a unique key for deduplication
      const parsed = JSON.parse(line);
      const key = `${parsed.timestamp}-${parsed.message}-${parsed.service || ''}`;
      
      // Only push if we haven't seen this exact message
      if (!this.seenMessages.has(key)) {
        this.seenMessages.add(key);
        this.push(parsed);
        
        // Clear old messages periodically to prevent memory growth
        if (this.seenMessages.size > 1000) {
          this.seenMessages.clear();
        }
      }
    } catch (err) {
      // For non-JSON lines, pass through as-is
      this.push({ timestamp: new Date().toISOString(), level: 'error', message: chunk.toString() });
    }
    callback();
  }
}

// Custom transform stream for pretty formatting
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
      
      this.push(`${timestamp} ${serviceStr}[${level?.toUpperCase() || 'ERROR'}] ${message}${metaStr}\n`);
    } catch (err) {
      // If formatting fails, output raw message
      this.push(`${chunk.toString()}\n`);
    }
    callback();
  }
}

export function watchLogs(type = 'all', lines = 50, pretty = true) {
  // Ensure log directory exists
  if (!fs.existsSync(LOG_DIR)) {
    console.error(`Log directory not found: ${LOG_DIR}`);
    process.exit(1);
  }

  // Get today's date for log files
  const today = new Date().toISOString().split('T')[0];
  
  // Define log file patterns based on type
  const patterns = type === 'all' 
    ? ['api', 'frontend', 'error', 'combined'].map(t => `${t}-${today}.log`)
    : [`${type}-${today}.log`];

  // Find existing log files
  const logFiles = patterns
    .map(pattern => join(LOG_DIR, pattern))
    .filter(path => fs.existsSync(path));

  if (logFiles.length === 0) {
    console.error('No matching log files found');
    console.error('Available files:', fs.readdirSync(LOG_DIR).join(', '));
    process.exit(1);
  }

  // Create transform streams
  const logTransform = new LogTransform();
  const prettyTransform = pretty ? new PrettyFormatTransform() : new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      this.push(JSON.stringify(chunk, null, 2) + '\n');
      callback();
    }
  });

  // Watch each log file
  const processes = logFiles.map(logFile => {
    console.log(`Watching: ${logFile}`);
    
    // Use tail -F instead of -f to handle log rotation
    const tail = spawn('tail', ['-n', lines.toString(), '-F', logFile]);

    // Pipe through our transforms
    tail.stdout
      .pipe(logTransform)
      .pipe(prettyTransform)
      .pipe(process.stdout);

    // Handle errors
    tail.stderr.on('data', data => {
      console.error(`Error watching ${logFile}:`, data.toString());
    });

    return tail;
  });

  // Cleanup handler
  const cleanup = () => {
    console.log('\nStopping log viewer...');
    processes.forEach(proc => {
      try {
        proc.kill();
      } catch (err) {
        // Ignore kill errors
      }
    });
    process.exit(0);
  };

  // Handle interrupts
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}