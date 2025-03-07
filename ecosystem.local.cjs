// ecosystem.local.cjs - DO NOT COMMIT THIS FILE
// Add to .gitignore

const baseConfig = require('./ecosystem.config.cjs');

// Override environment variables with actual credentials
const apps = baseConfig.apps.map(app => {
  // Add the real database URLs
  if (app.name === 'degenduel-api' || app.name === 'degenduel-api-test') {
    app.env.MARKET_DATABASE_URL = 'postgres://branchmanager:***REMOVED***\!***REMOVED***@localhost:5432/degenduel_market_data';
    app.env.REFLECTIONS_DATABASE_URL = 'postgres://reflections:reflections_password@localhost:5432/degenduel_reflections';
  }
  return app;
});

module.exports = { apps };
