import mysql from 'mysql2/promise';
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'app_db',
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
// Quick DB ping utility
export async function pingDb(): Promise<boolean> {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return Array.isArray(rows);
  } catch (err) {
    // Log only the error message for quick diagnosis; avoid leaking secrets
    console.error('DB ping failed:', (err as any)?.message || err);
    return false;
  }
}
