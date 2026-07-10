// PM2 process definition for ronserver2. Mirrors the AMT deploy pattern:
//   pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// The single Node process serves both the JSON API and the built web/ SPA.
module.exports = {
  apps: [
    {
      name: 'docsign-server',
      cwd: './server',
      script: 'src/app.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      out_file: './logs/docsign-out.log',
      error_file: './logs/docsign-err.log',
      time: true
    }
  ]
};
