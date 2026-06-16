module.exports = {
  apps: [
    {
      name: "gmg-api",
      script: "index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
