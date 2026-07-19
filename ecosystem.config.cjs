const shared = {
  cwd: __dirname,
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  kill_timeout: 30_000,
  time: true,
  env_production: {
    NODE_ENV: "production",
    BACKGROUND_TASK_MODE: "external",
    UPLOAD_MAINTENANCE_ENABLED: "true",
  },
};

module.exports = {
  apps: [
    {
      ...shared,
      name: "roadshow-training-system",
      script: "npm",
      args: "start",
      max_memory_restart: "1G",
    },
    {
      ...shared,
      name: "roadshow-background-worker",
      script: "npm",
      args: "run worker:start",
      max_memory_restart: "768M",
    },
  ],
};
