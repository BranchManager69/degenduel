# Database Summary Tools

These tools provide quick and comprehensive summaries of the DegenDuel database structure and content.

## Available Tools

### 1. Node.js Full Report (`db-summary-report.js`)

A comprehensive JavaScript implementation that generates a detailed Markdown report:

```bash
# Run the Node.js version
node tools/db-summary-report.js

# The report will be saved to reports/db-summary-YYYY-MM-DD.md
```

Features:
- Detailed statistics on all major tables
- User role distribution
- Token refresh priority tiers
- Contest statistics
- Service monitoring summary
- WebSocket system usage
- AI system statistics
- Database size and migration information

### 2. Bash Quick Summary (`db-summary.sh`)

A simple shell script for generating a quick text-based overview:

```bash
# Run the shell script version
./tools/db-summary.sh

# The report will be saved to reports/db-summary-YYYY-MM-DD_HH-MM-SS.txt
```

Features:
- Basic counts for main tables
- User role distribution
- Active token count
- Contest status summary
- Service log highlights
- Database size information

## Output

Both tools save their reports to the `reports/` directory with timestamps in the filenames.

## Requirements

- PostgreSQL client (`psql`) must be installed and in the PATH
- Node.js (for the JavaScript version)
- Proper database connection credentials (either in the DATABASE_URL environment variable or hardcoded in the scripts)

## Usage Tips

1. For regular monitoring, the bash script is faster and more lightweight
2. For comprehensive analysis, use the Node.js version
3. You can automate these reports by adding them to cron jobs