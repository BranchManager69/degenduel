// /config/swagger.js
import dotenv from 'dotenv';
import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { responses, schemas } from './swagger-schemas.js';

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
    './routes/tokenBuckets.js', // Token bucket routes
    './routes/auth.js',         // Auth routes
    './routes/users.js'         // User routes
  ]
};

let swaggerSpec;
try {
  console.log('Initializing Swagger with single route file...');
  swaggerSpec = swaggerJsDoc(options);
  
  if (!swaggerSpec.paths || Object.keys(swaggerSpec.paths).length === 0) {
    console.warn('No routes detected from tokenBuckets.js');
    console.log('Schemas loaded:', Object.keys(swaggerSpec.components?.schemas || {}));
    console.log('Security schemes:', Object.keys(swaggerSpec.components?.securitySchemes || {}));
  } else {
    console.log('Successfully loaded routes:', Object.keys(swaggerSpec.paths));
    console.log('Available operations:', Object.keys(swaggerSpec.paths).map(path => {
      const operations = swaggerSpec.paths[path];
      return `${path}: ${Object.keys(operations).join(', ')}`;
    }));
  }
} catch (error) {
  console.error('Failed to initialize Swagger:', error);
  if (error.mark) {
    // YAML parsing error details
    console.error('YAML Error Details:');
    console.error(`Line ${error.mark.line}, Column ${error.mark.column}`);
    console.error(`Near: ${error.mark.snippet}`);
  }
  swaggerSpec = {
    openapi: '3.0.0',
    info: {
      title: 'DegenDuel API',
      version: '1.0.0',
      description: 'API documentation unavailable due to initialization error'
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
