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
    './routes/*.js',
    './routes/dd-serv/*.js',
    './routes/prisma/*.js'
  ]
};

const swaggerSpec = swaggerJsDoc(options);

function setupSwagger(app) {
  const swaggerUiOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: '⚔️ | DegenDuel API',
    customfavIcon: '/favicon.ico'
  };

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
  console.log('Swagger docs available at /api-docs');
}

export default setupSwagger;