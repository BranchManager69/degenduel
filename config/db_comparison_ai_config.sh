#!/bin/bash

# Database Comparison AI Analysis Configuration
# --------------------------------------------
# This file contains configuration settings ONLY for the database comparison AI analysis feature
# in the db-tools.sh script. These settings DO NOT affect any other AI features in the application.
# 
# IMPORTANT: These environment variables are only active during the execution of the db-tools.sh script
# and do not persist beyond that or affect other parts of the application.

# API Settings for Database Comparison Analysis
export OPENAI_MODEL="o3-mini"         # Model to use for database comparison analysis (options: gpt-4o, gpt-4o-mini, o1, o1-mini, o3-mini)
export OPENAI_TEMPERATURE="0.3"      # Temperature (0.0-1.0, lower = more deterministic)
                                    # Note: Temperature is not supported for o3-mini model and will be omitted
export OPENAI_MAX_TOKENS="2000"      # Maximum tokens in the response
                                    # Note: For o1 and o3 models, this will be used as max_completion_tokens

# Prompt Settings for Database Schema Comparison
export OPENAI_SYSTEM_PROMPT="You are a PostgreSQL and Prisma ORM expert who provides clear, actionable advice for reconciling database differences."

export OPENAI_CONTEXT="
IMPORTANT CONTEXT:
1. DegenDuel uses Prisma ORM for database management, NOT direct SQL commands
2. All database changes should be implemented via Prisma migrations
3. The application is a gaming platform for cryptocurrency trading contests"

export OPENAI_FOCUS="
Focus on:
1. Critical differences that would affect application functionality
2. Concise Prisma migration steps to fix each critical difference, grouped by priority
3. A step-by-step action plan with no more than 5 key steps"

export OPENAI_INSTRUCTIONS="Keep your response concise and actionable, with clear section headings and bullet points where appropriate. If you are unable to find any critical differences, respond with 'No critical differences found'."

# End of database comparison AI analysis configuration
