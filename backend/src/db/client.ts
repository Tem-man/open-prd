import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREATE_SESSIONS_TABLE,
  CREATE_MESSAGES_TABLE,
  CREATE_PRDS_TABLE,
} from './schema.js';
import { runMigrations } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 生产环境（Electron）通过 DB_PATH 环境变量覆盖路径
const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(__dirname, '../../data/prd.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(CREATE_SESSIONS_TABLE);
  _db.exec(CREATE_MESSAGES_TABLE);
  _db.exec(CREATE_PRDS_TABLE);

  runMigrations(_db);

  return _db;
}
