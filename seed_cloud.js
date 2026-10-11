/* ============================================================
   DAFFODIL INTERNATIONAL COLLEGE (DIC) ALUMNI PLATFORM
   Cloud PostgreSQL Database Schema & Dummy Seed Data Uploader
   ============================================================ */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || process.argv[2];

if (!connectionString) {
  console.error('❌ Error: No Cloud PostgreSQL DATABASE_URL provided.');
  console.log('Usage: DATABASE_URL="postgresql://user:pass@cloud-host/dbname" node seed_cloud.js');
  console.log('Or: node seed_cloud.js "postgresql://user:pass@cloud-host/dbname"');
  process.exit(1);
}

console.log('🚀 Connecting to Cloud PostgreSQL Database...');
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to Cloud PostgreSQL Database!');

    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    console.log('📦 Executing schema.sql (Creating tables)...');
    await client.query(schemaSql);
    console.log('✅ Schema tables created successfully!');

    const seedSql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
    console.log('🌱 Executing seed.sql (Populating dummy seed data)...');
    await client.query(seedSql);
    console.log('✅ Dummy seed data uploaded successfully!');

    const res = await client.query('SELECT COUNT(*) FROM users');
    console.log(`🎉 Complete! Total users in Cloud PostgreSQL: ${res.rows[0].count}`);

    client.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error uploading to Cloud PostgreSQL:', err.message);
    process.exit(1);
  }
}

main();
