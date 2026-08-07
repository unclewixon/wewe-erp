#!/bin/sh
set -e
echo "[entrypoint] waiting for database…"
i=0
until node -e "const{Client}=require('pg');new Client({connectionString:process.env.DATABASE_URL}).connect().then(c=>{c.end();process.exit(0)}).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i+1)); [ $i -gt 60 ] && { echo "[entrypoint] database not reachable after 120s"; exit 1; }
  sleep 2
done
echo "[entrypoint] applying schema (drizzle push)…"
node_modules/.bin/drizzle-kit push
if [ "${SEED_DEMO:-0}" = "1" ]; then
  USERS=$(node -e "const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query('select count(*)::int n from users')).then(r=>{process.stdout.write(String(r.rows[0].n));return c.end()}).catch(()=>process.stdout.write('0'))")
  if [ "$USERS" = "0" ]; then
    echo "[entrypoint] seeding demo organisation…"
    node_modules/.bin/ts-node --transpile-only scripts/seed.ts
  else
    echo "[entrypoint] users present ($USERS) — skipping seed"
  fi
fi
echo "[entrypoint] starting API…"
exec node dist/src/main.js
