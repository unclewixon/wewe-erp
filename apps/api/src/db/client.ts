import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://wewe:wewe_dev@localhost:5432/wewe_erp',
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
