# AI SQL Generator for DegenDuel Admins

This feature allows admins to query the database using natural language. The system converts plain English questions into SQL queries, executes them, and provides analysis of the results.

## Overview

The AI SQL Generator provides three main functionalities:

1. **Generate SQL**: Convert natural language questions to SQL queries
2. **Execute SQL**: Run the generated queries and return results
3. **Analyze Results**: Provide insights and recommendations based on the data

## Endpoints

### 1. Generate SQL

```
POST /api/admin/ai/sql/generate
```

**Request:**
```json
{
  "question": "How many users joined in the last 7 days?"
}
```

**Response:**
```json
{
  "sql": "SELECT COUNT(*) as new_users FROM users WHERE created_at >= NOW() - INTERVAL '7 days'",
  "explanation": "This query counts the number of users with a created_at date within the last 7 days from the current time."
}
```

### 2. Execute SQL

```
POST /api/admin/ai/sql/execute
```

**Request:**
```json
{
  "sql": "SELECT COUNT(*) as new_users FROM users WHERE created_at >= NOW() - INTERVAL '7 days'"
}
```

**Response:**
```json
{
  "results": [
    {
      "new_users": 142
    }
  ],
  "executionTime": "54ms",
  "rowCount": 1,
  "sql": "SELECT COUNT(*) as new_users FROM users WHERE created_at >= NOW() - INTERVAL '7 days' LIMIT 1000"
}
```

### 3. Analyze Results

```
POST /api/admin/ai/sql/analyze
```

**Request:**
```json
{
  "results": [
    { "date": "2025-03-25", "new_users": 24 },
    { "date": "2025-03-26", "new_users": 18 },
    { "date": "2025-03-27", "new_users": 35 },
    { "date": "2025-03-28", "new_users": 22 },
    { "date": "2025-03-29", "new_users": 27 },
    { "date": "2025-03-30", "new_users": 42 },
    { "date": "2025-03-31", "new_users": 38 }
  ],
  "question": "What was our daily user growth over the last week?"
}
```

**Response:**
```json
{
  "analysis": "User growth over the past week shows a generally positive trend with an average of 29.4 new users per day. The highest growth occurred on March 30th with 42 new users, while the lowest was on March 26th with only 18 new users. There's a noticeable upward trend in the latter part of the week, with the last three days consistently above the weekly average.",
  
  "insights": [
    "Weekend days (March 30-31) show significantly higher user acquisition (42 and 38 users) compared to weekdays",
    "Overall growth trend is positive with a 58.3% increase when comparing the beginning and end of the period",
    "Mid-week engagement (March 27) showed a notable spike that disrupts the otherwise consistent pattern"
  ],
  
  "recommendations": [
    "Consider enhancing weekend marketing efforts to capitalize on the higher user acquisition rates during those periods",
    "Investigate what drove the March 27th spike to potentially replicate its success",
    "Monitor whether the positive trend continues into the next week, with particular attention to the daily growth rate"
  ]
}
```

### 4. Get Schema Information

```
GET /api/admin/ai/sql/schema-info
```

**Response:**
```json
{
  "schema": "// Full Prisma schema as a string..."
}
```

## React Integration Example

Here's a simple React component that demonstrates how to use the AI SQL Generator:

```jsx
import React, { useState } from 'react';
import axios from 'axios';

function AiSqlGenerator() {
  const [question, setQuestion] = useState('');
  const [sql, setSql] = useState('');
  const [explanation, setExplanation] = useState('');
  const [results, setResults] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Generate SQL from question
  const generateSql = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await axios.post('/api/admin/ai/sql/generate', { question });
      setSql(response.data.sql);
      setExplanation(response.data.explanation);
    } catch (err) {
      setError(`Failed to generate SQL: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Execute the generated SQL
  const executeSql = async () => {
    if (!sql) return;
    
    setLoading(true);
    setError('');
    
    try {
      const response = await axios.post('/api/admin/ai/sql/execute', { sql });
      setResults(response.data.results);
    } catch (err) {
      setError(`Failed to execute SQL: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Analyze the results
  const analyzeResults = async () => {
    if (!results) return;
    
    setLoading(true);
    setError('');
    
    try {
      const response = await axios.post('/api/admin/ai/sql/analyze', { 
        results,
        question
      });
      setAnalysis(response.data);
    } catch (err) {
      setError(`Failed to analyze results: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-sql-generator">
      <h1>AI SQL Generator</h1>
      
      {/* Step 1: Question Input */}
      <div className="step">
        <h2>Step 1: Ask a question</h2>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g., How many users joined in the last 7 days?"
          className="question-input"
        />
        <button onClick={generateSql} disabled={!question || loading}>
          Generate SQL
        </button>
      </div>
      
      {/* Step 2: SQL Review */}
      {sql && (
        <div className="step">
          <h2>Step 2: Review SQL</h2>
          <div className="sql-container">
            <pre>{sql}</pre>
          </div>
          <div className="explanation">
            <strong>Explanation:</strong> {explanation}
          </div>
          <button onClick={executeSql} disabled={loading}>
            Execute SQL
          </button>
        </div>
      )}
      
      {/* Step 3: Results */}
      {results && (
        <div className="step">
          <h2>Step 3: Results</h2>
          <div className="results-container">
            <pre>{JSON.stringify(results, null, 2)}</pre>
          </div>
          <button onClick={analyzeResults} disabled={loading}>
            Analyze Results
          </button>
        </div>
      )}
      
      {/* Step 4: Analysis */}
      {analysis && (
        <div className="step">
          <h2>Step 4: Analysis</h2>
          <div className="analysis-container">
            <h3>Summary</h3>
            <p>{analysis.analysis}</p>
            
            <h3>Key Insights</h3>
            <ul>
              {analysis.insights.map((insight, i) => (
                <li key={i}>{insight}</li>
              ))}
            </ul>
            
            <h3>Recommendations</h3>
            <ul>
              {analysis.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default AiSqlGenerator;
```

## Security Notes

1. All queries are restricted to SELECT statements only
2. A 1000-row limit is automatically applied if no LIMIT is specified
3. All queries are logged for audit purposes
4. Authentication is required (admin or superadmin role)

## Best Practices

1. **Be specific in your questions**
   - "How many users registered in March 2025" is better than "How many users do we have"

2. **Verify generated SQL before execution**
   - The two-step flow (generate → execute) allows admins to review queries before running them

3. **Avoid very complex analytical questions in one go**
   - Break down complex analyses into multiple simpler queries

4. **Consider response size**
   - Very large result sets may impact performance or be truncated

## Example Questions

- "What are the top 10 tokens by trading volume in the last 24 hours?"
- "Show me all contests created in the past week with their participation rates" 
- "Which users have entered the most contests but haven't won any?"
- "What's the average wallet balance for users who joined in the last month?"
- "Find all IP addresses that tried to access the site more than 10 times in the last hour"
- "Which contest had the highest number of participants last month?"