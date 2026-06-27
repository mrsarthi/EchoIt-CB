const { pool } = require('./db.js');

async function wipeDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE users CASCADE');
    await client.query('COMMIT');
    console.log("Wiped all data successfully.");
  } catch(e) {
    await client.query('ROLLBACK');
    console.error("Wipe failed", e);
  } finally {
    client.release();
    pool.end();
  }
}
wipeDB();
