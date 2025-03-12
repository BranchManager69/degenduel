export const schemas = {
  TokenBucket: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      description: { type: 'string' }
    }
  },
  User: {
    type: 'object',
    properties: {
      wallet_address: { type: 'string' },
      nickname: { type: 'string' },
      role: { type: 'string' }
    }
  }
};

export const responses = {
  UnauthorizedError: {
    description: 'Authentication information is missing or invalid',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          }
        }
      }
    }
  },
  NotFoundError: {
    description: 'The specified resource was not found',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          }
        }
      }
    }
  }
}; 