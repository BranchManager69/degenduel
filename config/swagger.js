// /config/swagger.js
import dotenv from 'dotenv';
import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { responses, schemas } from './swagger-schemas.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

dotenv.config();

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
      url: 'http://localhost:3003/api',
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

// Start with just one route file for testing
const options = {
  definition: swaggerDefinition,
  apis: [
    // Admin routes
    path.join(rootDir, 'routes/admin/faucet-management.js'),
    path.join(rootDir, 'routes/admin/maintenance.js'),
    path.join(rootDir, 'routes/admin/service-metrics.js'),
    path.join(rootDir, 'routes/admin/token-sync.js'),
    path.join(rootDir, 'routes/admin/vanity-wallet-management.js'),
    path.join(rootDir, 'routes/admin/wallet-management.js'),
    
    // Core routes
    path.join(rootDir, 'routes/auth.js'),
    path.join(rootDir, 'routes/contests.js'),
    path.join(rootDir, 'routes/dd-serv/tokens.js'),
    path.join(rootDir, 'routes/portfolio-analytics.js'),
    path.join(rootDir, 'routes/portfolio-trades.js'),
    path.join(rootDir, 'routes/referrals.js'),
    path.join(rootDir, 'routes/status.js'),
    path.join(rootDir, 'routes/superadmin.js'),
    path.join(rootDir, 'routes/tokenBuckets.js'),
    path.join(rootDir, 'routes/tokens.js'),
    path.join(rootDir, 'routes/trades.js'),
    path.join(rootDir, 'routes/users.js'),
    path.join(rootDir, 'routes/v2/tokens.js'),

    // Prisma routes
    path.join(rootDir, 'routes/prisma/activity.js'),
    path.join(rootDir, 'routes/prisma/admin.js'),
    path.join(rootDir, 'routes/prisma/balance.js'),
    path.join(rootDir, 'routes/prisma/leaderboard.js'),
    path.join(rootDir, 'routes/prisma/stats.js')
  ]
};

let swaggerSpec;
try {
  console.log('\n🔍 Initializing Swagger documentation...');
  console.log('📁 Scanning the following route files:');
  options.apis.forEach(file => console.log(`   - ${file}`));
  
  swaggerSpec = swaggerJsDoc(options);
  
  if (!swaggerSpec.paths || Object.keys(swaggerSpec.paths).length === 0) {
    console.warn('\n⚠️  Warning: No routes detected in documentation');
    console.log('🔍 Debug information:');
    console.log('   Schemas loaded:', Object.keys(swaggerSpec.components?.schemas || {}).length);
    console.log('   Security schemes:', Object.keys(swaggerSpec.components?.securitySchemes || {}).length);
  } else {
    const routeCount = Object.keys(swaggerSpec.paths).length;
    console.log('\n✅ Successfully loaded API documentation:');
    console.log(`   - ${routeCount} unique endpoints documented`);
    console.log('   - Routes found:');
    Object.keys(swaggerSpec.paths).forEach(path => {
      const operations = swaggerSpec.paths[path];
      console.log(`     ${path}:`);
      Object.keys(operations).forEach(method => {
        console.log(`       - ${method.toUpperCase()}`);
      });
    });
  }
} catch (error) {
  console.error('\n❌ Failed to initialize Swagger:', error);
  if (error.mark) {
    console.error('📍 YAML Error Details:');
    console.error(`   Line ${error.mark.line}, Column ${error.mark.column}`);
    console.error(`   Near: ${error.mark.snippet}`);
  }
  if (error.stack) {
    console.error('\n🔍 Stack trace:');
    console.error(error.stack);
  }
  swaggerSpec = {
    openapi: '3.0.0',
    info: {
      title: 'DegenDuel API',
      version: '1.0.0',
      description: '⚠️ API documentation unavailable due to initialization error'
    },
    paths: {}
  };
}

function setupSwagger(app) {
  const swaggerUiOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: '⚔️ | DegenDuel API',
    customfavIcon: '/favicon.ico',
    explorer: true,
    swaggerOptions: {
      displayRequestDuration: true,
      persistAuthorization: true
    }
  };

  app.get('/api-docs-json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
  console.log('Swagger docs available at /api-docs');
}

export default setupSwagger;
