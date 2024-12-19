import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';

dotenv.config();

// Swagger definition
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'DegenDuel API',
    version: '1.0.0',
    description: 'Documentation for the DegenDuel API',
  },
  servers: [
    {
      url: 'https://degenduel.me',
      description: 'Production server',
    },
    {
      url: 'http://localhost:3003',
      description: 'Development server',
    },
  ],
};

// Options for Swagger docs
const swaggerOptions = {
  swaggerDefinition,
  apis: ['routes/*.js', 'routes/prisma/*.js'], // Adjust relative path to the route files
  customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.4.2/swagger-ui.css',
};

// Initialize Swagger JSDoc
const swaggerSpec = swaggerJsDoc(swaggerOptions);

function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  console.log('Swagger docs available at /api-docs');
}

export default setupSwagger; // ES6 default export