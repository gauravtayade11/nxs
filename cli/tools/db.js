/**
 * nxs db — Database error analyzer
 * Supports: PostgreSQL, MySQL, MongoDB, Redis, SQLite
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { runAnalyze, runHistory } from '../core/runner.js';
import { run } from '../core/exec.js';

const SYSTEM_PROMPT = `You are a senior database administrator (DBA) with expertise in PostgreSQL, MySQL, MongoDB, Redis, and SQLite. Analyze the provided database error, slow query log, or connection failure output.

Return a JSON object with exactly this structure:

{
  "tool": "<postgres|mysql|mongodb|redis|sqlite|unknown>",
  "severity": "<one of: critical, warning, info>",
  "database": "<detected database type>",
  "errorCode": "<the specific error code if detectable, e.g. SQLSTATE 42P01, ORA-00942, etc.>",
  "summary": "<1-2 sentence plain-English summary of the database issue>",
  "rootCause": "<numbered breakdown of what went wrong and why>",
  "fixSteps": "<step-by-step fix — ordered from most likely to least likely cause>",
  "commands": "<exact SQL/CLI commands to diagnose and fix>"
}

Severity rules:
- critical: data loss risk, DB completely down, replication broken, disk full
- warning: connection pool exhausted, slow queries degrading performance, authentication failure
- info: deprecation warning, minor config suggestion

Key patterns to detect:
PostgreSQL:
- "FATAL: password authentication failed" — wrong password or pg_hba.conf
- "ERROR: relation does not exist" — table missing, wrong schema
- "FATAL: too many connections" — connection pool exhausted
- "deadlock detected" — transaction deadlock
- "could not connect to server" — DB down or network issue
- "ERROR: disk full" — storage issue

MySQL:
- "ERROR 1045 (28000): Access denied" — auth failure
- "ERROR 1049 (42000): Unknown database" — DB doesn't exist
- "ERROR 1205 (HY000): Lock wait timeout exceeded" — lock contention
- "ERROR 2002 (HY000): Can't connect to MySQL server" — DB down

MongoDB:
- "MongoServerSelectionError" — cannot reach MongoDB server
- "Authentication failed" — wrong credentials
- "E11000 duplicate key error" — unique index violation
- "connection pool exhausted" — too many connections

Redis:
- "NOAUTH Authentication required" — password not set
- "ERR max number of clients reached" — maxclients limit
- "OOM command not allowed" — out of memory

Return ONLY valid JSON. No markdown fences.`;

const MOCK_RESPONSES = {
  postgres_conn: {
    tool: 'postgres', severity: 'critical', database: 'PostgreSQL', errorCode: 'FATAL',
    summary: 'PostgreSQL refusing connections — too many clients connected. Application is completely blocked from accessing the database.',
    rootCause: '1. The max_connections limit (default: 100) has been reached.\n2. Application is not releasing connections back to the pool.\n3. Long-running idle transactions are holding connections open.\n4. No connection pooler (PgBouncer) in front of PostgreSQL.',
    fixSteps: '- Immediate: restart idle connections — SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = \'idle\' AND query_start < now() - interval \'10 minutes\';\n- Check current connections: SELECT count(*) FROM pg_stat_activity;\n- Short-term: increase max_connections in postgresql.conf (requires restart)\n- Long-term: add PgBouncer as a connection pooler in front of PostgreSQL\n- Review application connection pool settings (pool_size, timeout)',
    commands: "SELECT count(*), state FROM pg_stat_activity GROUP BY state;\nSELECT pid, usename, application_name, state, query_start FROM pg_stat_activity ORDER BY query_start;\nSELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '10 minutes';\nSHOW max_connections;",
  },
  postgres_auth: {
    tool: 'postgres', severity: 'warning', database: 'PostgreSQL', errorCode: 'SQLSTATE 28P01',
    summary: 'PostgreSQL authentication failed — password is incorrect or user does not have access.',
    rootCause: '1. Password provided does not match the one stored for the user in pg_authid.\n2. pg_hba.conf may require a different authentication method (md5 vs scram-sha-256).\n3. User may not exist in PostgreSQL.\n4. Connecting from an IP not allowed in pg_hba.conf.',
    fixSteps: '- Verify user exists: SELECT usename FROM pg_user;\n- Reset password: ALTER USER myuser WITH PASSWORD \'newpassword\';\n- Check pg_hba.conf for auth method — if md5, ensure app is sending md5-hashed password\n- Check connection is coming from an allowed IP range in pg_hba.conf\n- Reload config after changes: SELECT pg_reload_conf();',
    commands: "psql -U postgres -c \"SELECT usename, passwd IS NOT NULL AS has_password FROM pg_shadow;\"\npsql -U postgres -c \"ALTER USER myuser WITH PASSWORD 'newpassword';\"\ncat /etc/postgresql/14/main/pg_hba.conf\npsql -U postgres -c \"SELECT pg_reload_conf();\"",
  },
  mysql_lock: {
    tool: 'mysql', severity: 'warning', database: 'MySQL', errorCode: 'ERROR 1205 (HY000)',
    summary: 'MySQL lock wait timeout exceeded — a transaction is waiting too long for a row lock held by another transaction.',
    rootCause: '1. Transaction A holds a lock on a row that Transaction B is waiting for.\n2. innodb_lock_wait_timeout (default: 50s) elapsed before the lock was released.\n3. Long-running transactions or large batch operations commonly cause this.',
    fixSteps: '- Find blocking transactions: SELECT * FROM information_schema.INNODB_TRX;\n- Kill the blocking transaction if safe: KILL <trx_mysql_thread_id>;\n- Review application code — ensure transactions are short and committed quickly\n- Increase innodb_lock_wait_timeout temporarily if needed\n- Consider using SELECT ... FOR UPDATE NOWAIT to fail fast instead of wait',
    commands: 'SELECT * FROM information_schema.INNODB_TRX;\nSELECT r.trx_id waiting_trx_id, r.trx_mysql_thread_id waiting_thread, b.trx_id blocking_trx_id, b.trx_mysql_thread_id blocking_thread FROM information_schema.INNODB_LOCK_WAITS w JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_trx_id JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_trx_id;\nSHOW VARIABLES LIKE "innodb_lock_wait_timeout";',
  },
  mongodb_conn: {
    tool: 'mongodb', severity: 'critical', database: 'MongoDB', errorCode: 'MongoServerSelectionError',
    summary: 'MongoDB server selection timed out — application cannot connect to any member of the replica set.',
    rootCause: '1. MongoDB server is not running or not reachable on the specified host/port.\n2. The connection string may have incorrect host, port, or replica set name.\n3. Authentication credentials may be wrong.\n4. Network firewall blocking port 27017.',
    fixSteps: '- Check if MongoDB is running: systemctl status mongod\n- Verify connection string format: mongodb://user:pass@host:27017/dbname?authSource=admin\n- Test connectivity: mongosh "mongodb://host:27017" --eval "db.runCommand({ ping: 1 })"\n- Check firewall: nc -zv host 27017\n- For replica set: ensure all members are reachable and the set name matches',
    commands: 'systemctl status mongod\nmongosh --eval "db.adminCommand({ ping: 1 })"\nmongosh --eval "rs.status()" # replica set status\nnc -zv localhost 27017\njournalctl -u mongod --since "1 hour ago"',
  },
  redis: {
    tool: 'redis', severity: 'warning', database: 'Redis', errorCode: 'OOM',
    summary: 'Redis is out of memory — new write commands are being rejected.',
    rootCause: '1. Redis has reached its maxmemory limit.\n2. The eviction policy (maxmemory-policy) is set to noeviction, so writes fail instead of evicting keys.\n3. Keys may not have TTLs set, causing unbounded growth.',
    fixSteps: '- Check memory usage: redis-cli INFO memory\n- Check eviction policy: CONFIG GET maxmemory-policy\n- Change policy to allkeys-lru to auto-evict: CONFIG SET maxmemory-policy allkeys-lru\n- Increase maxmemory if server has headroom: CONFIG SET maxmemory 2gb\n- Find largest keys: redis-cli --bigkeys\n- Set TTLs on keys that don\'t need to live forever',
    commands: 'redis-cli INFO memory\nredis-cli CONFIG GET maxmemory\nredis-cli CONFIG GET maxmemory-policy\nredis-cli CONFIG SET maxmemory-policy allkeys-lru\nredis-cli --bigkeys\nredis-cli DEBUG SLEEP 0',
  },
};

function mockAnalyze(logText) {
  const lower = logText.toLowerCase();
  if (lower.includes('too many connections') || lower.includes('remaining connection slots')) return MOCK_RESPONSES.postgres_conn;
  if (lower.includes('password authentication failed') || lower.includes('access denied') && lower.includes('mysql')) return MOCK_RESPONSES.postgres_auth;
  if (lower.includes('lock wait timeout') || lower.includes('1205')) return MOCK_RESPONSES.mysql_lock;
  if (lower.includes('mongoserverselection') || lower.includes('replica set')) return MOCK_RESPONSES.mongodb_conn;
  if (lower.includes('oom') || lower.includes('out of memory') && lower.includes('redis')) return MOCK_RESPONSES.redis;
  if (lower.includes('postgres') || lower.includes('pg_') || lower.includes('pgsql')) return MOCK_RESPONSES.postgres_conn;
  if (lower.includes('mysql') || lower.includes('innodb') || lower.includes('mariadb')) return MOCK_RESPONSES.mysql_lock;
  if (lower.includes('mongo') || lower.includes('mongodb')) return MOCK_RESPONSES.mongodb_conn;
  if (lower.includes('redis')) return MOCK_RESPONSES.redis;
  return MOCK_RESPONSES.postgres_conn;
}

export function registerDb(program) {
  const db = program
    .command('db')
    .description('Analyze database errors — PostgreSQL, MySQL, MongoDB, Redis');

  db
    .command('diagnose [file]')
    .description('Analyze a database error or connection failure')
    .option('-s, --stdin', 'Read from stdin')
    .option('-i, --interactive', 'Paste error interactively')
    .option('-j, --json', 'Output as JSON')
    .option('--no-chat', 'Skip follow-up chat')
    .option('--redact', 'Scrub secrets/passwords before sending to AI')
    .option('-o, --output <file>', 'Save analysis to a markdown file')
    .option('--fail-on <severity>', 'Exit code 1 if severity matches (critical|warning)')
    .addHelpText('after', `
Examples:
  $ cat /var/log/postgresql/postgresql.log | nxs db diagnose --stdin
  $ kubectl logs my-postgres-pod | nxs db diagnose --stdin
  $ nxs db diagnose error.log
  $ nxs db diagnose --interactive`)
    .action(async (file, opts) => {
      if (!opts.json) printBanner('Database error analyzer');
      await runAnalyze('db', SYSTEM_PROMPT, mockAnalyze, file, opts);
    });

  db
    .command('connections')
    .description('Monitor PostgreSQL connections — auto-kill idle when threshold hit')
    .option('--pod <name>',         'Postgres pod name (kubectl exec)')
    .option('--ns, --namespace <ns>','Namespace for --pod (default: default)')
    .option('--url <url>',          'Connection string: postgresql://user:pass@host:5432/db')
    .option('--threshold <n>',      'Kill idle connections when total exceeds this (default: 80%)', '80')
    .option('--idle-after <mins>',  'Kill connections idle longer than N minutes (default: 10)', '10')
    .option('--watch',              'Keep watching — refresh every 10s, auto-kill on threshold')
    .option('--dry-run',            'Show what would be killed without actually killing')
    .option('--interval <secs>',    'Watch interval in seconds (default: 10)', '10')
    .addHelpText('after', `
Examples:
  $ nxs db connections --pod my-postgres-pod -n production
  $ nxs db connections --pod my-postgres-pod -n production --watch
  $ nxs db connections --pod my-postgres-pod -n production --watch --threshold 70 --idle-after 5
  $ nxs db connections --pod my-postgres-pod -n production --dry-run`)
    .action(async (opts) => {
      printBanner('Database connection monitor');

      if (!opts.pod && !opts.url) {
        console.error(chalk.red('  Provide --pod <name> or --url <connection-string>'));
        console.error(chalk.dim('  Example: nxs db connections --pod my-postgres -n production'));
        process.exit(1);
      }

      const ns        = opts.namespace ? `-n "${opts.namespace}"` : '';
      const threshold = Number.parseInt(opts.threshold, 10);
      const idleAfter = Number.parseInt(opts.idleAfter, 10);
      const interval  = Number.parseInt(opts.interval, 10) * 1000;

      // Build the psql runner
      const psql = async (sql) => {
        if (opts.pod) {
          const { stdout, stderr } = await run(
            `kubectl exec "${opts.pod}" ${ns} -- psql -U postgres -t -c "${sql.replaceAll('"', '\\"')}" 2>/dev/null`
          );
          return (stdout || stderr || '').trim();
        }
        const { stdout, stderr } = await run(`psql "${opts.url}" -t -c "${sql.replaceAll('"', '\\"')}" 2>/dev/null`);
        return (stdout || stderr || '').trim();
      };

      // Verify connection
      const pingResult = await psql('SELECT 1');
      if (!pingResult.includes('1')) {
        console.error(chalk.red(`  Cannot connect to PostgreSQL.`));
        if (opts.pod) console.error(chalk.dim(`  Check pod name and namespace: kubectl get pods ${ns}`));
        else console.error(chalk.dim('  Check your connection string.'));
        process.exit(1);
      }

      const tick = async () => {
        // Clear screen on watch
        if (opts.watch) process.stdout.write('\x1Bc');
        printBanner('Database connection monitor');

        // Get max_connections
        const maxRaw = await psql('SHOW max_connections');
        const maxConn = Number.parseInt(maxRaw, 10) || 100;
        const killThreshold = Math.floor(maxConn * threshold / 100);

        // Get connection breakdown
        const statsRaw = await psql(`
          SELECT state, count(*) as cnt
          FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
          GROUP BY state
          ORDER BY cnt DESC
        `);

        const stats = {};
        statsRaw.split('\n').filter(Boolean).forEach((row) => {
          const parts = row.trim().split('|').map((s) => s.trim());
          if (parts.length === 2) stats[parts[0] || 'null'] = Number.parseInt(parts[1], 10);
        });

        const total   = Object.values(stats).reduce((a, b) => a + b, 0);
        const active  = stats['active']  || 0;
        const idle    = stats['idle']    || 0;
        const waiting = stats['idle in transaction'] || 0;
        const pct     = Math.round((total / maxConn) * 100);

        // Get top idle connections with duration
        const idleRaw = await psql(`
          SELECT pid, usename, application_name,
                 round(extract(epoch from (now()-query_start))/60)::int AS idle_mins,
                 left(query, 60) AS last_query
          FROM pg_stat_activity
          WHERE state = 'idle'
          AND pid <> pg_backend_pid()
          ORDER BY query_start ASC
          LIMIT 15
        `);

        const idleConns = idleRaw.split('\n').filter(Boolean).map((row) => {
          const [pid, user, app, mins, query] = row.split('|').map((s) => s.trim());
          return { pid, user, app, mins: Number.parseInt(mins, 10) || 0, query };
        }).filter((r) => r.pid);

        // ─── Print dashboard ──────────────────────────────────────────
        const barFill   = Math.round(pct / 5);
        const barColor  = pct >= threshold ? chalk.red : pct >= 60 ? chalk.yellow : chalk.green;
        const bar       = barColor('█'.repeat(barFill)) + chalk.dim('░'.repeat(20 - barFill));

        console.log(chalk.bold('\n  CONNECTION POOL\n'));
        console.log(hr());
        console.log(`\n  Max connections : ${chalk.white(maxConn)}`);
        console.log(`  Total used      : ${barColor.bold(total)} / ${maxConn}  [${bar}] ${barColor.bold(pct + '%')}`);
        console.log(`  Active          : ${chalk.cyan(active)}`);
        console.log(`  Idle            : ${idle > 0 ? chalk.yellow(idle) : chalk.dim(idle)}`);
        console.log(`  Idle in txn     : ${waiting > 0 ? chalk.red(waiting) : chalk.dim(waiting)}`);
        console.log(`  Kill threshold  : ${chalk.dim(threshold + '% = ' + killThreshold + ' connections')}`);

        if (opts.watch) {
          console.log(chalk.dim(`\n  Auto-refresh: every ${opts.interval}s  |  Ctrl+C to stop`));
        }

        if (idleConns.length > 0) {
          const toKill = idleConns.filter((c) => c.mins >= idleAfter);
          console.log(chalk.bold(`\n  IDLE CONNECTIONS (${idleConns.length} total)\n`));
          console.log(hr());
          console.log(chalk.dim(`\n  ${'PID'.padEnd(8)} ${'User'.padEnd(16)} ${'Idle (min)'.padEnd(12)} Last query`));
          idleConns.forEach((c) => {
            const stale = c.mins >= idleAfter;
            const pidStr  = (stale ? chalk.red : chalk.dim)(c.pid.padEnd(8));
            const userStr = chalk.white(c.user?.padEnd(16) ?? '?'.padEnd(16));
            const minStr  = (stale ? chalk.red.bold : chalk.yellow)((c.mins + ' min').padEnd(12));
            const qStr    = chalk.dim(c.query?.slice(0, 50) ?? '');
            console.log(`  ${pidStr} ${userStr} ${minStr} ${qStr}`);
          });

          // ─── Auto-kill logic ───────────────────────────────────────
          if (total >= killThreshold && toKill.length > 0) {
            console.log();
            if (opts.dryRun) {
              console.log(chalk.yellow(`\n  ⚠  DRY RUN — would kill ${toKill.length} idle connection(s) (idle > ${idleAfter}min)\n`));
              toKill.forEach((c) => console.log(chalk.dim(`    PID ${c.pid} — ${c.user} — idle ${c.mins}min`)));
            } else {
              console.log(chalk.red(`\n  ⚡ THRESHOLD HIT (${total}/${maxConn} = ${pct}%) — killing ${toKill.length} idle connection(s)\n`));
              const pids = toKill.map((c) => c.pid).join(', ');
              const killSql = `SELECT pid, pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid IN (${pids})`;
              await psql(killSql);
              toKill.forEach((c) => {
                console.log(chalk.green(`    ✓ Killed PID ${c.pid} — ${c.user} — idle ${c.mins}min`));
              });
              console.log(chalk.dim(`\n    Killed ${toKill.length} idle connection(s). Pool should recover.\n`));
            }
          } else if (total >= killThreshold && toKill.length === 0) {
            console.log(chalk.yellow(`\n  ⚠  Threshold hit but no connections idle > ${idleAfter}min yet.\n`));
          } else {
            console.log(chalk.green(`\n  ✓  Pool healthy — below threshold (${total}/${killThreshold})\n`));
          }
        } else {
          console.log(chalk.green('\n  ✓  No idle connections.\n'));
        }

        console.log(hr());
        console.log(chalk.dim(`\n  Tip: nxs db connections --pod ${opts.pod || 'my-pod'} --watch --threshold ${threshold} --idle-after ${idleAfter}\n`));
      };

      // Run once or loop
      await tick();

      if (opts.watch) {
        process.on('SIGINT', () => {
          console.log(chalk.dim('\n  Stopped watching.\n'));
          process.exit(0);
        });
        setInterval(tick, interval);
      }
    });

  db
    .command('history')
    .description('Show past database analyses')
    .option('-n, --limit <n>', 'Number of entries', '10')
    .option('--clear', 'Clear db history')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
      printBanner('Database error analyzer');
      await runHistory('db', opts);
    });

  db
    .command('errors')
    .description('Quick reference for common database errors')
    .action(() => {
      printBanner('Database error analyzer');
      console.log(chalk.bold('\n  Common database errors — what they mean\n'));
      console.log(hr());

      const dbs = [
        {
          name: 'PostgreSQL',
          color: chalk.hex('#336791'),
          errors: [
            { code: 'FATAL: too many connections',           tip: 'max_connections hit — add PgBouncer or increase limit' },
            { code: 'ERROR: relation does not exist',        tip: 'Table/view missing — check schema, migration ran?' },
            { code: 'FATAL: password authentication failed', tip: 'Wrong password or pg_hba.conf auth mismatch' },
            { code: 'deadlock detected',                     tip: 'Two transactions blocking each other — review transaction order' },
            { code: 'could not connect to server',           tip: 'DB down or network issue — check service + firewall' },
          ],
        },
        {
          name: 'MySQL / MariaDB',
          color: chalk.hex('#f29111'),
          errors: [
            { code: 'ERROR 1045: Access denied',             tip: 'Auth failure — check user, host, password in mysql.user' },
            { code: 'ERROR 1205: Lock wait timeout',         tip: 'Transaction lock contention — find and kill blocking trx' },
            { code: 'ERROR 1062: Duplicate entry',           tip: 'Unique constraint violation — deduplicate before insert' },
            { code: 'ERROR 2002: Can\'t connect',            tip: 'MySQL not running or socket path wrong' },
          ],
        },
        {
          name: 'MongoDB',
          color: chalk.hex('#13aa52'),
          errors: [
            { code: 'MongoServerSelectionError',             tip: 'Can\'t reach server — check host, port, replica set name' },
            { code: 'E11000 duplicate key error',            tip: 'Unique index violated — check _id or unique field' },
            { code: 'Authentication failed',                 tip: 'Wrong credentials or authSource — check connection string' },
            { code: 'connection pool exhausted',             tip: 'maxPoolSize hit — increase or check for connection leaks' },
          ],
        },
        {
          name: 'Redis',
          color: chalk.hex('#dc382d'),
          errors: [
            { code: 'OOM command not allowed',               tip: 'maxmemory hit — change eviction policy or increase limit' },
            { code: 'NOAUTH Authentication required',        tip: 'Redis requires password — set requirepass in config' },
            { code: 'ERR max number of clients reached',     tip: 'maxclients limit — increase or check for connection leaks' },
            { code: 'WRONGTYPE Operation against key',       tip: 'Key exists with different type — check key naming' },
          ],
        },
      ];

      dbs.forEach(({ name, color, errors }) => {
        console.log(`\n  ${color(`■ ${name}`)}`);
        errors.forEach(({ code, tip }) => {
          console.log(`\n    ${chalk.bold.white(code)}`);
          console.log(chalk.dim(`    ${tip}`));
        });
      });

      console.log('\n' + hr());
      console.log(chalk.dim('\n  Pipe any DB log to: kubectl logs my-db-pod | nxs db diagnose --stdin\n'));
    });
}
