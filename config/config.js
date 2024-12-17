import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 3003,
  environment: process.env.NODE_ENV || 'production',
  jwt: {
    secret: process.env.JWT_SECRET || `zif8W4G/GR6V1ofUke0pdWR1isF18JOXsRege+W9QJCssZd+qwoWH2IU3XnYy/aZ
gbD9JEVMmy5t+duw8mbN2Q==`
  }
};