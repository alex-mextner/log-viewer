module.exports = {
  apps: [
    {
      name: 'log-viewer',
      script: 'src/index.ts',
      interpreter: '/home/www-data/.bun/bin/bun',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Restart if memory exceeds 200MB
      max_memory_restart: '200M',
      // Restart on file changes (disabled in production)
      watch: false,
      // Log files
      error_file: '/var/www/log-viewer/logs/error.log',
      out_file: '/var/www/log-viewer/logs/out.log',
      // Merge stdout and stderr
      merge_logs: true,
      // Time format for logs
      time: true,
    },
  ],
};
