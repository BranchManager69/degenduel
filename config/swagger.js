// /config/swagger.js
import dotenv from 'dotenv';
import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

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
      url: process.env.API_URL || 'https://degenduel.me',
      description: 'Production server'
    },
    {
      url: 'http://localhost:3003',
      description: 'Development server'
    }
  ],
  components: {
    schemas: {},
    responses: {},
    securitySchemes: {}
  }
};

const options = {
  definition: swaggerDefinition,
  apis: [
    './src/routes/*.js',
    './src/routes/dd-serv/*.js',
    './src/routes/prisma/*.js',
    './routes/*.js',
    './routes/dd-serv/*.js',
    './routes/prisma/*.js'
  ]
};

let swaggerSpec;
try {
  swaggerSpec = swaggerJsDoc(options);
} catch (error) {
  console.error('Failed to initialize Swagger:', error);
  swaggerSpec = {
    openapi: '3.0.0',
    info: {
      title: 'DegenDuel API',
      version: '1.0.0',
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
  
  const routes = Object.keys(swaggerSpec.paths || {});
  console.log('Detected API routes:', routes.length ? routes : 'None found');
}

export default setupSwagger;
