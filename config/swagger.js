// /config/swagger.js
import dotenv from 'dotenv';
import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { responses, schemas } from './swagger-schemas.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logApi } from '../utils/logger-suite/logger.js'; // new

dotenv.config();

const VERBOSE_SWAGGER_INIT = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// Swagger definition
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'DegenDuel API',
    version: '1.0.0',
    description: 'Documentation for the DegenDuel API'
  },
  servers: [
    {
      url: process.env.API_URL || 'https://degenduel.me/api',
      description: 'Production server'
    },
    {
      url: 'https://dev.degenduel.me/api',
      description: 'Development server'
    }
  ],
  components: {
    schemas,
    responses,
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'session'
      }
    }
  }
};

// *****
// Automatically discover all route files
function discoverRoutes(directory) {
  const routes = [];
  let totalFiles = 0;
  
  function scanDirectory(dir) {
    try {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        // Skip node_modules and hidden directories
        if (file.startsWith('.') || file === 'node_modules') continue;
        
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          
          if (stat.isDirectory()) {
            // Recursively scan subdirectories
            scanDirectory(filePath);
          } else if (file.endsWith('.js') && !file.includes('.test.js') && !file.includes('.spec.js')) {
            // Add JS files (excluding test files)
            totalFiles++;
            if (filePath.includes('/routes/') || filePath.includes('/docs/swagger/')) {
              routes.push(filePath);
            }
          }
        } catch (err) {
          // Skip any files that can't be accessed
          continue;
        }
      }
    } catch (err) {
      // Skip directories that can't be read
      return;
    }
  }
  
  scanDirectory(directory);
  
  if (VERBOSE_SWAGGER_INIT) {
    console.log(`Auto-discovered ${routes.length} route files (from ${totalFiles} total JS files)`);
  }
  
  return routes;
}

// Add manually defined API docs for items that are not in route files
// These include server health API and WebSocket documentation
const additionalApiDocs = [
  path.join(rootDir, 'docs/swagger/websocket-api.js'),
  path.join(rootDir, 'docs/swagger/server-health-api.js'),
  path.join(rootDir, 'docs/swagger/admin-service-metrics.js'),
  path.join(rootDir, 'docs/swagger/admin-websocket-test.js'),
  path.join(rootDir, 'docs/swagger/admin-circuit-breaker.js'),
  path.join(rootDir, 'docs/swagger/admin-service-management.js'),
  path.join(rootDir, 'docs/swagger/admin-maintenance.js'),
  path.join(rootDir, 'docs/swagger/admin-contest-management.js'),
  path.join(rootDir, 'docs/swagger/admin-liquidity-management.js'),
  path.join(rootDir, 'docs/swagger/admin-token-sync.js'),
  path.join(rootDir, 'docs/swagger/admin-wallet-management.js'),
  path.join(rootDir, 'docs/swagger/admin-analytics-dashboard.js')
];

const options = {
  definition: swaggerDefinition, // Swagger definition
  apis: [...discoverRoutes(rootDir), ...additionalApiDocs] // Auto-discovered routes + manually added docs
};

// Initialize Swagger specification
let swaggerSpec;
swaggerSpec = swaggerJsDoc(options);
  
// Initialize Swagger documentation
if (VERBOSE_SWAGGER_INIT) {
  logApi.info('\n🔍 Initializing Swagger documentation...');
  logApi.info('🗄️\t Scanning the following route files:');
  options.apis.forEach(file => logApi.info(`🗃️\t\t ${file}`));
}

// Check if Swagger specification is empty
if (!swaggerSpec.paths || Object.keys(swaggerSpec.paths).length === 0) {
  logApi.warn('\n☠️ Error: No routes detected in documentation');
  logApi.log('🪲\t Debug information:');
  logApi.log('\t\t Schemas loaded:  ', Object.keys(swaggerSpec.components?.schemas || {}).length);
  logApi.log('\t\t Security schemes:', Object.keys(swaggerSpec.components?.securitySchemes || {}).length);
} else {
  const routeCount = Object.keys(swaggerSpec.paths).length;
  if (VERBOSE_SWAGGER_INIT) {
    logApi.info('\n✅ Successfully loaded DegenDuel API documentation:');
    logApi.info(`   - ${routeCount} unique endpoints documented`);
    logApi.info('   - Routes found:');

    // Iterate through all paths and methods
    Object.keys(swaggerSpec.paths).forEach(path => {
      // Get operations from the current path
      const operations = swaggerSpec.paths[path];
      const operationCount = Object.keys(operations).length;
      // Log paths and the operations within
      logApi.info(`🟰🟰\t\t(${operationCount})\t${path}`);
      if (VERBOSE_SWAGGER_INIT) {
        // Log every operation from each path
        Object.keys(operations).forEach(method => {
          logApi.info(`\t\t\t➖ ${method.toUpperCase()}`);
        });
      }
    });
    if (VERBOSE_SWAGGER_INIT) {
      logApi.info('\n✅ Successfully loaded DegenDuel API documentation');    
    }
    if (routeCount > 0) {
      logApi.info('\n⭐ Swagger API documentation successfully loaded! \n\tAvailable at [URL]/api-docs');
    } else {
      logApi.warn('\n⚠️ No routes found in the Swagger API documentation');
    }
  }
}

// Error handling for swagger operations is handled in the setupSwagger function below

// Swagger setup options
function setupSwagger(app) {
  const swaggerUiOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'DegenDuel API | Documentation',
    customfavIcon: '/favicon.ico',
    explorer: true,
    swaggerOptions: {
      displayRequestDuration: true,
      persistAuthorization: true
    }
  };

  try {
    // Swagger main documentation endpoint
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
    logApi.info('\t\t🌐 Main API docs: \thttps://degenduel.me/api-docs');

    // Additional Swagger JSON docs endpoint (JSON version)
    app.get('/api-docs-json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
    logApi.info('\t\t🌐 JSON API docs: \thttps://degenduel.me/api-docs-json');
  
  } catch (error) {
    logApi.error('\n\t❌ Failed to initialize Swagger:', error);
  }
}

export default setupSwagger;