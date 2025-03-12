#!/bin/bash

# Prisma Schema Reconciliation AI Analysis Configuration
# --------------------------------------------
# This file contains configuration settings ONLY for the Prisma schema reconciliation AI analysis feature
# in the db-tools.sh script. These settings DO NOT affect any other AI features in the application.
# 
# IMPORTANT: These environment variables are only active during the execution of the db-tools.sh script
# and do not persist beyond that or affect other parts of the application.

# API Settings for Prisma Reconciliation Analysis
export PRISMA_OPENAI_MODEL="gpt-4o"        # Model to use for Prisma schema reconciliation analysis
export PRISMA_OPENAI_TEMPERATURE="0.5"      # Temperature (0.0-1.0, lower = more deterministic)
                                           # Note: Temperature is not supported for o3-mini model
export PRISMA_OPENAI_MAX_TOKENS="4000"      # Maximum tokens in the response
                                           # Note: For o1 and o3 models, this will be used as max_completion_tokens

# Prompt Settings for Prisma Schema Reconciliation
export PRISMA_OPENAI_SYSTEM_PROMPT="You are a Prisma ORM and PostgreSQL schema expert who specializes in detecting and resolving discrepancies between Prisma schema definitions and actual database structures."

export PRISMA_OPENAI_CONTEXT="
IMPORTANT CONTEXT:
1. DegenDuel uses Prisma ORM for database management
2. We need to identify all discrepancies between the Prisma schema definitions and the actual PostgreSQL database structure
3. The goal is to reconcile these differences to maintain schema integrity
4. Migration issues may have caused these discrepancies"

export PRISMA_OPENAI_FOCUS="
Focus on:
1. Identifying ALL differences between the Prisma schema and the actual database (using [+] for additions and [-] for removals)
2. Categorizing differences by type: tables, columns, types, constraints, indexes, and relationships
3. Cross-checking _prisma_migrations with the prisma/migrations/ folder
4. Providing precise Prisma migration commands to fix each issue"

export PRISMA_OPENAI_INSTRUCTIONS="Document all differences thoroughly using [+] and [-] notation. Be extremely comprehensive and detailed, as these insights will be used to fix critical schema management issues. Structure your response with clear headings and organize issues by priority level."

# End of Prisma reconciliation AI analysis configuration
