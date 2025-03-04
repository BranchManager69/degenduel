# DegenDuel Unified Logging System

## Current Logging Challenges

The current DegenDuel logging system has several limitations:

1. **Log File Proliferation**: Winston creates numerous rotated log files (over 96 files per day) taking up to 1.9GB of disk space daily
2. **Disconnected PM2 Logs**: PM2 process logs are stored separately from application logs, making it difficult to correlate events
3. **Limited Searchability**: Searching across hundreds of log files is inefficient and error-prone
4. **No Visualization**: No dashboards or metrics to monitor system health proactively
5. **Inconsistent Formats**: Different log sources use different formats, making aggregation difficult

## Proposed Solution: Unified Logging Infrastructure

We recommend implementing a comprehensive logging solution based on the ELK stack (Elasticsearch, Logstash, Kibana) that integrates all logging sources.

### 1. Architecture Overview

```
┌───────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Log Sources  │────▶│  Log Shipper │────▶│ Elasticsearch│────▶│    Kibana    │
└───────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
  • Winston logs                                 ^
  • PM2 logs                                     │
  • System logs                                  │
  • Nginx logs         ┌──────────────┐         │
                       │   Logstash   │─────────┘
                       └──────────────┘
```

### 2. Implementation Components

#### A. Elasticsearch Setup

- Deploy Elasticsearch (single node for dev, cluster for production)
- Configure index templates with appropriate mappings for log data
- Set up index lifecycle management (ILM) for log retention

#### B. Log Collection

1. **Winston Integration**:
   - Add Elasticsearch transport to Winston
   - Implement structured JSON logging
   - Add context data (request ID, service name, etc.)

2. **PM2 Log Integration**:
   - Install PM2 log rotation module: `pm2 install pm2-logrotate`
   - Configure centralized log forwarding
   - Update ecosystem.config.cjs with standardized log settings

3. **System Log Collection**:
   - Deploy Filebeat to collect system logs
   - Configure log forwarding to Elasticsearch

#### C. Log Processing

- Configure Logstash for advanced processing scenarios:
  - Parsing error stacks
  - Extracting fields from unstructured logs
  - Enriching logs with additional metadata

#### D. Visualization & Monitoring

- Create Kibana dashboards for:
  - Error rates and distribution
  - API performance metrics
  - Service health indicators
  - User activity patterns
- Set up alerts for critical conditions

### 3. Implementation Plan

#### Phase 1: Infrastructure Setup (2 days)

1. Create a Docker Compose configuration for local ELK stack
2. Deploy basic ELK stack to a dedicated VM
3. Configure basic security and access controls
4. Test connectivity and basic log ingestion

#### Phase 2: Application Integration (3 days)

1. Refactor Winston logger to support structured logging
2. Implement Elasticsearch transport with error handling
3. Configure PM2 to forward logs to the central system
4. Update service initializers to use the new logger

#### Phase 3: Dashboards & Monitoring (2 days)

1. Define key metrics and KPIs to monitor
2. Create Kibana dashboards for different use cases
3. Set up alerting for critical conditions
4. Document search patterns for common debugging scenarios

### 4. Code Changes Required

#### Winston Logger Refactoring

```javascript
// utils/logger-suite/elasticsearch-logger.js
import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

const esTransport = new ElasticsearchTransport({
  level: 'info',
  clientOpts: { node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200' },
  indexPrefix: 'degenduel-logs',
  source: process.env.NODE_ENV || 'development'
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    esTransport
  ]
});

// Add request context middleware
const addRequestLogging = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  req.logger = logger.child({ requestId, path: req.path });
  next();
};

export { logger, addRequestLogging };
```

#### PM2 Configuration Updates

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'degenduel-api',
      script: 'index.js',
      log_type: 'json',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        ELASTICSEARCH_URL: 'http://elasticsearch:9200'
      }
    }
  ]
};
```

#### Docker Compose Configuration

```yaml
# docker-compose.elk.yml
version: '3'
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.8.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"
    volumes:
      - elasticsearch-data:/usr/share/elasticsearch/data
    
  kibana:
    image: docker.elastic.co/kibana/kibana:8.8.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch
    
  logstash:
    image: docker.elastic.co/logstash/logstash:8.8.0
    ports:
      - "5044:5044"
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
    depends_on:
      - elasticsearch

volumes:
  elasticsearch-data:
```

### 5. Benefits of the New Approach

1. **Centralized Visibility**: All logs in one searchable place
2. **Reduced Disk Usage**: Efficient storage and indexing (estimated 70-80% reduction)
3. **Improved Debugging**: Faster root cause analysis across services
4. **Proactive Monitoring**: Alerts on error spikes or performance issues
5. **Better Context**: Correlation between application and infrastructure events

### 6. Estimated Resource Requirements

- **Storage**: ~20GB for 30 days of logs (vs. ~60GB with current system)
- **Memory**: 4GB minimum for Elasticsearch
- **CPU**: 2 cores minimum for the logging stack
- **Implementation Effort**: ~7 developer days

### 7. Migration Strategy

1. Deploy the new system alongside the existing one
2. Gradually migrate services to use the new logger
3. Create initial dashboards based on common debugging needs
4. Run both systems in parallel for 2 weeks
5. Switch over completely once confidence is established

## Next Steps

1. Allocate resources for dedicated logging infrastructure
2. Create a feature branch for the initial implementation
3. Deploy basic ELK stack and test with a single service
4. Evaluate results and adjust the implementation plan as needed