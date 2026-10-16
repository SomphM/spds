import 'dotenv/config';
import sql from 'mssql';
export { sql };
export const config = {
  server: process.env.DB_SERVER || 'localhost', port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'SPDS', user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: process.env.DB_ENCRYPT !== 'false', trustServerCertificate: process.env.DB_TRUST_CERTIFICATE === 'true', useUTC: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }, connectionTimeout: 10000, requestTimeout: 15000
};
let pool;
export async function database() {
  if (!pool) pool = new sql.ConnectionPool(config).connect().catch(error => { pool = undefined; throw error; });
  return pool;
}
export async function closeDatabase() { if (pool) await (await pool).close(); pool = undefined; }
