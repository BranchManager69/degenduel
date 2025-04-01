// routes/admin/ai-sql.js

/**
 * @swagger
 * tags:
 *   name: AdminAI
 *   description: AI-enhanced admin tools
 */

import express from 'express';
import { AIApi } from '../../api/aiApi.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { requireAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Get Prisma schema for context
const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
let prismaSchema = '';
try {
  prismaSchema = fs.readFileSync(schemaPath, 'utf8');
} catch (error) {
  logApi.error('Failed to read Prisma schema:', error);
  prismaSchema = 'Failed to load schema';
}

/**
 * @swagger
 * /api/admin/ai/sql/generate:
 *   post:
 *     summary: Generate SQL from natural language question
 *     tags: [AdminAI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *             properties:
 *               question:
 *                 type: string
 *                 description: Natural language question to convert to SQL
 *     responses:
 *       200:
 *         description: Generated SQL query
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sql:
 *                   type: string
 *                   description: Generated SQL query
 *                 explanation:
 *                   type: string
 *                   description: Explanation of the query
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Not authenticated as admin
 *       500:
 *         description: Server error
 */
router.post('/generate', requireAdmin, async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question || typeof question !== 'string' || question.trim() === '') {
      return res.status(400).json({ 
        error: 'Invalid request: question is required',
        type: 'invalid_request'
      });
    }
    
    // Create a system prompt that explains the task and enforces the rules
    const messages = [
      {
        role: 'user',
        content: `I need to convert this natural language question into a valid PostgreSQL query for our DegenDuel database.
        
Question: "${question}"

Here is our database schema:
\`\`\`prisma
${prismaSchema}
\`\`\`

Generate ONLY a SELECT query - never generate UPDATE, INSERT, DELETE, DROP, CREATE, ALTER or any other data-modifying SQL statements.
Format your response as a JSON object with these properties:
1. "sql": The complete SQL query that answers the question
2. "explanation": A brief explanation of what the query does and why you structured it this way

Important rules:
- ONLY include SELECT statements (read-only)
- The query must be valid PostgreSQL syntax
- Prefer JOINs over subqueries when appropriate
- Use table aliases for clarity in complex queries
- Use date functions for time calculations
- Limit results to 1000 rows max with "LIMIT 1000" unless another limit is specified
- Assume table names match Prisma model names (users = "users" table)
- Pay careful attention to data relationships in the schema`
      }
    ];
    
    // Use the coding loadout for more precise and controlled responses
    const result = await AIApi.generateCompletionWithLoadout(
      messages,
      'coding',
      {
        userId: req.user.id || req.user.wallet_address,
        userRole: 'admin',
      }
    );
    
    // Parse the result content as JSON
    let sqlData;
    try {
      // Try to parse the entire content as JSON
      sqlData = JSON.parse(result.content);
    } catch (error) {
      // If parsing fails, try to extract JSON from markdown code block
      const jsonMatch = result.content.match(/```json\n([\s\S]*?)\n```/) || 
                        result.content.match(/```\n([\s\S]*?)\n```/) ||
                        result.content.match(/{[\s\S]*}/);
                        
      if (jsonMatch) {
        try {
          sqlData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch (e) {
          return res.status(500).json({
            error: 'Failed to parse AI response as JSON',
            type: 'server_error',
            aiResponse: result.content
          });
        }
      } else {
        // Try to extract sql directly if JSON parsing fails
        const sql = result.content.replace(/^.*?sql.*?:/, '').split('\n')[0].trim();
        sqlData = {
          sql: sql.replace(/^['"]|['"]$/g, ''),
          explanation: 'AI generated explanation unavailable'
        };
      }
    }
    
    // Perform basic safety checks on the SQL
    if (!sqlData.sql || typeof sqlData.sql !== 'string') {
      return res.status(500).json({
        error: 'Invalid SQL generated',
        type: 'server_error'
      });
    }
    
    // Check that only SELECT statements are present
    const sql = sqlData.sql.trim().toUpperCase();
    if (!sql.startsWith('SELECT') || 
        sql.includes('UPDATE ') || 
        sql.includes('DELETE ') || 
        sql.includes('INSERT ') || 
        sql.includes('DROP ') || 
        sql.includes('ALTER ') || 
        sql.includes('CREATE ')) {
      
      return res.status(400).json({
        error: 'Invalid SQL: only SELECT statements are allowed',
        type: 'invalid_request',
        sql: sqlData.sql
      });
    }
    
    // Log the generated SQL for audit purposes
    logApi.info(`Admin ${req.user.id || req.user.wallet_address} generated SQL:`, {
      question,
      sql: sqlData.sql,
      explanation: sqlData.explanation
    });
    
    // Return the generated SQL for review
    return res.status(200).json({
      sql: sqlData.sql,
      explanation: sqlData.explanation || 'No explanation provided'
    });
    
  } catch (error) {
    logApi.error('Error generating SQL:', error);
    return res.status(500).json({
      error: 'Failed to generate SQL',
      type: 'server_error'
    });
  }
});

/**
 * @swagger
 * /api/admin/ai/sql/execute:
 *   post:
 *     summary: Execute an SQL query and return results
 *     tags: [AdminAI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sql
 *             properties:
 *               sql:
 *                 type: string
 *                 description: SQL query to execute (must be SELECT only)
 *     responses:
 *       200:
 *         description: Query results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   description: Query results
 *                 executionTime:
 *                   type: string
 *                   description: Time taken to execute the query
 *                 rowCount:
 *                   type: number
 *                   description: Number of rows returned
 *       400:
 *         description: Invalid request parameters or non-SELECT query
 *       401:
 *         description: Not authenticated as admin
 *       500:
 *         description: Server error
 */
router.post('/execute', requireAdmin, async (req, res) => {
  const startTime = Date.now();
  try {
    const { sql } = req.body;
    
    if (!sql || typeof sql !== 'string' || sql.trim() === '') {
      return res.status(400).json({ 
        error: 'Invalid request: sql is required',
        type: 'invalid_request'
      });
    }
    
    // Safety check: ensure this is a SELECT statement
    const sqlUpper = sql.trim().toUpperCase();
    if (!sqlUpper.startsWith('SELECT') || 
        sqlUpper.includes('UPDATE ') || 
        sqlUpper.includes('DELETE ') || 
        sqlUpper.includes('INSERT ') || 
        sqlUpper.includes('DROP ') || 
        sqlUpper.includes('ALTER ') || 
        sqlUpper.includes('CREATE ')) {
      
      return res.status(400).json({
        error: 'Invalid SQL: only SELECT statements are allowed',
        type: 'invalid_request'
      });
    }
    
    // Force a row limit if one isn't specified
    let queryToExecute = sql;
    if (!sqlUpper.includes('LIMIT ')) {
      queryToExecute += ' LIMIT 1000';
    }
    
    // Execute the query using Prisma's $queryRawUnsafe
    // This allows executing raw SQL but only for SELECT statements that we've verified
    const results = await prisma.$queryRawUnsafe(queryToExecute);
    
    // Calculate execution time
    const executionTime = Date.now() - startTime;
    
    // Log query execution for audit trail
    logApi.info(`Admin ${req.user.id || req.user.wallet_address} executed SQL query:`, {
      sql: queryToExecute,
      rowCount: results.length,
      executionTime: `${executionTime}ms`
    });
    
    // Return results with metadata
    return res.status(200).json({
      results,
      executionTime: `${executionTime}ms`,
      rowCount: results.length,
      sql: queryToExecute
    });
    
  } catch (error) {
    logApi.error('Error executing SQL:', error);
    
    // Calculate execution time even for failed queries
    const executionTime = Date.now() - startTime;
    
    return res.status(500).json({
      error: `Failed to execute SQL: ${error.message}`,
      executionTime: `${executionTime}ms`,
      type: 'database_error'
    });
  }
});

/**
 * @swagger
 * /api/admin/ai/sql/analyze:
 *   post:
 *     summary: Analyze data from a SQL query and generate insights
 *     tags: [AdminAI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - results
 *               - question
 *             properties:
 *               results:
 *                 type: array
 *                 description: Results from a previously executed SQL query
 *               question:
 *                 type: string
 *                 description: Original question that generated the SQL
 *     responses:
 *       200:
 *         description: Analysis of the query results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 analysis:
 *                   type: string
 *                   description: AI-generated analysis of the data
 *                 insights:
 *                   type: array
 *                   description: Key insights extracted from the data
 *                 recommendations:
 *                   type: array
 *                   description: Recommendations based on the data
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Not authenticated as admin
 *       500:
 *         description: Server error
 */
router.post('/analyze', requireAdmin, async (req, res) => {
  try {
    const { results, question } = req.body;
    
    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request: results array is required',
        type: 'invalid_request'
      });
    }
    
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid request: original question is required',
        type: 'invalid_request'
      });
    }
    
    // Limit the size of the results to prevent token limits
    const resultsToAnalyze = results.slice(0, 100);
    const totalRows = results.length;
    
    // Create a prompt for analysis
    const messages = [
      {
        role: 'user',
        content: `Analyze these SQL query results and provide insights. The original question was: "${question}"
        
Here are the first ${resultsToAnalyze.length} rows out of ${totalRows} total rows:
\`\`\`json
${JSON.stringify(resultsToAnalyze, null, 2)}
\`\`\`

Provide your response as a JSON object with these fields:
1. "analysis": A comprehensive analysis of the data (1-2 paragraphs)
2. "insights": An array of 3-5 key insights/patterns observed in the data 
3. "recommendations": An array of 2-3 action items or follow-up queries that might be valuable

Focus on:
- Patterns and trends in the data
- Anomalies or outliers
- Business implications of the findings
- Actionable insights for DegenDuel administrators`
      }
    ];
    
    // Use the adminAnalysis loadout for structured analytical response
    const result = await AIApi.generateCompletionWithLoadout(
      messages,
      'adminAnalysis',
      {
        userId: req.user.id || req.user.wallet_address,
        userRole: 'admin',
      }
    );
    
    // Parse the result content as JSON
    let analysisData;
    try {
      // Try to parse the entire content as JSON
      analysisData = JSON.parse(result.content);
    } catch (error) {
      // If parsing fails, try to extract JSON from markdown code block
      const jsonMatch = result.content.match(/```json\n([\s\S]*?)\n```/) || 
                        result.content.match(/```\n([\s\S]*?)\n```/) ||
                        result.content.match(/{[\s\S]*}/);
                        
      if (jsonMatch) {
        try {
          analysisData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch (e) {
          // If still fails, create a structured object from the raw response
          analysisData = {
            analysis: result.content,
            insights: ["AI was unable to structure insights"],
            recommendations: ["Consider reviewing the full analysis text"]
          };
        }
      } else {
        analysisData = {
          analysis: result.content,
          insights: ["AI was unable to structure insights"],
          recommendations: ["Consider reviewing the full analysis text"]
        };
      }
    }
    
    // Return the analysis
    return res.status(200).json(analysisData);
    
  } catch (error) {
    logApi.error('Error analyzing SQL results:', error);
    return res.status(500).json({
      error: 'Failed to analyze results',
      type: 'server_error'
    });
  }
});

/**
 * @swagger
 * /api/admin/ai/sql/schema-info:
 *   get:
 *     summary: Get database schema information
 *     tags: [AdminAI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Database schema information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 models:
 *                   type: array
 *                   description: List of database models/tables
 *                 schema:
 *                   type: string
 *                   description: Raw prisma schema (for reference)
 *       401:
 *         description: Not authenticated as admin
 *       500:
 *         description: Server error
 */
router.get('/schema-info', requireAdmin, async (req, res) => {
  try {
    // Return the schema information
    return res.status(200).json({
      schema: prismaSchema,
      // Could add additional metadata like model counts, table relationships, etc.
    });
  } catch (error) {
    logApi.error('Error getting schema info:', error);
    return res.status(500).json({
      error: 'Failed to get schema information',
      type: 'server_error'
    });
  }
});

export default router;