import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { closePool, getDb } from '../server/db';

const schemaUrl = new URL('../db/schema.sql', import.meta.url);

const schema = await readFile(schemaUrl, 'utf8');
console.log('Applying db/schema.sql to', process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, '//***@') ?? '(no DATABASE_URL)');

const db = getDb();
await db.exec(schema);

const tables = await db.query<{ table_name: string }>(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('reports','employees','attendance','report_overview','period_trend')
    order by table_name`,
);
console.log('Ready:', tables.map((t) => t.table_name).join(', '));

await closePool();
