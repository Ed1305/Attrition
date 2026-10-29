import 'dotenv/config';
import { closePool, DatabaseNotConfiguredError, getDb, type Db } from '../server/db';
import { SCHEMA_SQL } from '../server/schema.ts';

console.log('Applying the Attrition schema to', process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, '//***@') ?? '(no DATABASE_URL)');

function connect(): Db {
  try {
    return getDb();
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      console.error('\n  DATABASE_URL is not set.\n');
      console.error('  1. Copy .env.example to .env.local');
      console.error('  2. Paste the Neon *pooled* connection string into DATABASE_URL');
      console.error('     (Neon console -> Connect -> Pooled connection)\n');
      process.exit(1);
    }
    throw err;
  }
}

const db = connect();
await db.exec(SCHEMA_SQL);

const tables = await db.query<{ table_name: string }>(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('reports','employees','attendance','report_overview','period_trend')
    order by table_name`,
);
console.log('Ready:', tables.map((t) => t.table_name).join(', '));

await closePool();
