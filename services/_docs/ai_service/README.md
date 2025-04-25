# DegenDuel AI Service Documentation

Welcome to the AI Service documentation for DegenDuel. This folder contains comprehensive documentation for all AI-related features available on the platform.

## Available Documentation

1. [AI Service Overview](./AI_SERVICE.md) - Complete documentation of the main AI service
   * Service architecture
   * On-demand chat completions
   * Periodic analysis capabilities
   * Loadout system for specialized configurations

2. [AI SQL Generator](./AI_SQL_GUIDE.md) - Guide for the AI-powered SQL generator for admins
   * Natural language to SQL conversion
   * Executing queries
   * Analyzing results
   * Frontend integration examples

## Quick Reference

### AI Loadout System

The AI Service uses a "loadout" system to configure AI behavior for different tasks:

| Loadout | Temperature | Tokens | Purpose |
|---------|-------------|--------|---------|
| default | 0.76 | 1000 | General-purpose assistance |
| degenTerminal | 0.9 | 600 | Creative, sassy responses for Degen Terminal |
| errorAnalysis | 0.3 | 2000 | Technical analysis of client errors |
| adminAnalysis | 0.3 | 2000 | Analysis of admin activities |
| trading | 0.5 | 1200 | Balanced trading advice |
| support | 0.3 | 1500 | Technical support responses |
| creative | 0.9 | 800 | Creative content generation |
| coding | 0.2 | 1500 | Programming and technical help |
| funny | 0.95 | 600 | Humor-focused responses |

### AI SQL Generator Features

The AI SQL Generator provides three main endpoints:

1. `/api/admin/ai/sql/generate` - Converts questions to SQL
2. `/api/admin/ai/sql/execute` - Executes SQL queries safely
3. `/api/admin/ai/sql/analyze` - Analyzes query results with AI

For detailed usage examples, see the [AI SQL Guide](./AI_SQL_GUIDE.md).