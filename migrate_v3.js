/* Applies schema_v3.sql. Idempotent.  Usage: node migrate_v3.js */
const fs = require('fs');
const path = require('path');
const db = require('./db');

(async () => {
  await db.query(fs.readFileSync(path.join(__dirname, 'schema_v3.sql'), 'utf8'));
  console.log('⚡ schema_v3 applied.');

  const cols = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'alumni_profiles'
      AND column_name IN ('occupation','hsc_group','hsc_version','photo_url')
    ORDER BY column_name`);
  console.log('📊 new profile columns:', cols.rows.map(r => r.column_name).join(', '));

  const u = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name IN ('must_change_password','created_via')
    ORDER BY column_name`);
  console.log('📊 new user columns:', u.rows.map(r => r.column_name).join(', '));

  const nn = await db.query(`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name='alumni_profiles' AND column_name='student_id'`);
  console.log('📊 student_id nullable:', nn.rows[0].is_nullable);
})().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
