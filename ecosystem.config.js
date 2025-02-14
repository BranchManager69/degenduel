module.exports = {
  apps: [
    {
      name: "degenduel-prod",
      script: "index.js",
      env: {
        NODE_ENV: "production",
        PORT: 3004,
        DATABASE_URL_PROD: "postgresql://user:pass@localhost:5432/degenduel",
        // Other production settings
      },
    },
    {
      name: "degenduel-dev",
      script: "index.js",
      env: {
        NODE_ENV: "development",
        PORT: 3005,  // Different port for dev
        DATABASE_URL: "postgresql://user:pass@localhost:5432/degenduel_test",
        // Other development settings
      },
    },
  ],
}; 