import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';

dotenv.config();

// Swagger definition
const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
      title: 'DegenDuel API', // Title of your API
      version: '1.0.0', // Version of your API
      description: 'Documentation for the DegenDuel API', // Short description
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' ? 'https://degenduel.me' : 'http://localhost:3003',
      },
    ],
  };

// Options for Swagger docs
const swaggerOptions = {
    swaggerDefinition,
    apis: ['routes/*.js'], // Adjust relative path to the route files
  };

// Initialize Swagger JSDoc
const swaggerSpec = swaggerJsDoc(swaggerOptions);

export function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  console.log('Swagger docs available at /api-docs');
}
