// Single process on purpose.
//
// `server.js` serves HTTP, hosts Socket.IO, restores scheduled dispatches and runs
// the subscription cron. Dispatch state and the Socket.IO instance are held in
// process memory, and Socket.IO has no cross-process adapter configured, so these
// roles cannot be duplicated:
//
//   * cluster mode (instances > 1) gives each worker its own Socket.IO server and
//     its own dispatch map. Emits reach only the clients on the same worker, and a
//     ride accepted on one worker cannot stop the dispatch timers running on
//     another - so drivers keep being offered a ride that is already taken.
//   * running the socket or scheduler role in a second process has the same effect:
//     every scheduled booking gets one dispatch per copy at pickup time, and the
//     subscription expiry pass runs concurrently with itself.
//
// `server.js` refuses to boot as a cluster instance for this reason. Scaling this
// service across cores or hosts needs a Socket.IO adapter (e.g. Redis) plus dispatch
// state moved into a shared store; only then split the roles back out using the
// ENABLE_SOCKET_SERVER / ENABLE_SCHEDULER / ENABLE_SUBSCRIPTION_CRON flags and add
// dedicated apps here for them. `socket-server.js` and `scheduler-server.js` remain
// in the repo as the entry points for that future split.
module.exports = {
  apps: [
    {
      name: 'gokab-api',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
};
