/* ============================================================
   DAFFODIL INTERNATIONAL COLLEGE (DIC) ALUMNI PLATFORM
   End-to-End Cloud PostgreSQL CRUD Verification Test Suite
   ============================================================ */

const db = require('./db');

async function runCrudTests() {
  console.log('\n🧪 Starting Full E2E Cloud PostgreSQL CRUD Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // ─── TEST 1: DATABASE CONNECTION & HEALTH ───
    console.log('1️⃣ Testing Database Connection & Health...');
    const timeRes = await db.query('SELECT NOW() as current_time, current_database() as db_name');
    assert(timeRes.rows.length > 0, `Connected to Cloud Database: "${timeRes.rows[0].db_name}"`);
    assert(db.isCloud === true, `Cloud SSL connection confirmed (db.isCloud = true)`);

    // ─── TEST 2: CREATE (INSERT) ───
    console.log('\n2️⃣ Testing CREATE (INSERT) Operations...');
    const testUserEmail = `test_crud_${Date.now()}@dic.edu.bd`;
    const userInsertRes = await db.query(
      `INSERT INTO users (email, password_hash, full_name, initials, role, role_label, department, icon, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [testUserEmail, 'hashedpass123', 'Test CRUD Engineer', 'TC', 'alumni', 'Alumni Member', 'CSE', '🎓', true]
    );
    const testUserId = userInsertRes.rows[0].id;
    assert(testUserId > 0, `Created User in Cloud PG (ID: ${testUserId})`);

    const studentId = `DIC-TEST-${Date.now()}`;
    const profileInsertRes = await db.query(
      `INSERT INTO alumni_profiles (user_id, student_id, batch, passing_year, department, bio, primary_email, current_company, job_title, skills)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [testUserId, studentId, 2024, 2024, 'Computer Science', 'Test bio for cloud database', testUserEmail, 'Tech Corp Cloud', 'Cloud Engineer', 'PostgreSQL, Node.js']
    );
    assert(profileInsertRes.rows[0].id > 0, `Created Alumni Profile in Cloud PG (Student ID: ${studentId})`);

    const chapterInsertRes = await db.query(
      `INSERT INTO chapters (name, type, icon, description, members_count, events_count, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      ['Cloud PG Test Chapter', 'interest', '⚡', 'Test association for cloud DB', 1, 0, 'approved']
    );
    const testChapterId = chapterInsertRes.rows[0].id;
    assert(testChapterId > 0, `Created Chapter in Cloud PG (ID: ${testChapterId})`);

    const storyInsertRes = await db.query(
      `INSERT INTO stories (emoji, category, title, excerpt, content, author_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      ['🧪', 'Testing', 'Cloud DB CRUD Test Post', 'Testing Cloud PG inserts', 'Full test article body', 'QA Suite', 'pending_review']
    );
    const testStoryId = storyInsertRes.rows[0].id;
    assert(testStoryId > 0, `Created Story in Cloud PG (ID: ${testStoryId})`);

    // ─── TEST 3: READ (SELECT) ───
    console.log('\n3️⃣ Testing READ (SELECT) Operations...');
    const readUser = await db.query('SELECT * FROM users WHERE id = $1', [testUserId]);
    assert(readUser.rows.length === 1 && readUser.rows[0].email === testUserEmail, `Read User by ID (${readUser.rows[0].full_name})`);

    const readProfile = await db.query('SELECT * FROM alumni_profiles WHERE user_id = $1', [testUserId]);
    assert(readProfile.rows.length === 1 && readProfile.rows[0].current_company === 'Tech Corp Cloud', `Read Profile by User ID (Company: ${readProfile.rows[0].current_company})`);

    const readChapter = await db.query('SELECT * FROM chapters WHERE id = $1', [testChapterId]);
    assert(readChapter.rows.length === 1 && readChapter.rows[0].name === 'Cloud PG Test Chapter', `Read Chapter by ID`);

    const readStories = await db.query('SELECT * FROM stories WHERE id = $1', [testStoryId]);
    assert(readStories.rows.length === 1 && readStories.rows[0].title === 'Cloud DB CRUD Test Post', `Read Story by ID`);

    // ─── TEST 4: UPDATE (UPDATE) ───
    console.log('\n4️⃣ Testing UPDATE Operations...');
    const updateProfileRes = await db.query(
      `UPDATE alumni_profiles SET job_title = $1, current_company = $2 WHERE user_id = $3 RETURNING job_title, current_company`,
      ['Lead Cloud Architect', 'Neon Database Inc', testUserId]
    );
    assert(updateProfileRes.rows[0].job_title === 'Lead Cloud Architect', `Updated Profile Job Title to "Lead Cloud Architect"`);

    const updateChapterRes = await db.query(
      `UPDATE chapters SET members_count = members_count + 5 WHERE id = $1 RETURNING members_count`,
      [testChapterId]
    );
    assert(updateChapterRes.rows[0].members_count === 6, `Updated Chapter Member Count to 6`);

    const updateStoryRes = await db.query(
      `UPDATE stories SET status = 'published' WHERE id = $1 RETURNING status`,
      [testStoryId]
    );
    assert(updateStoryRes.rows[0].status === 'published', `Updated Story Status to "published"`);

    // ─── TEST 5: DELETE (DELETE) ───
    console.log('\n5️⃣ Testing DELETE Operations...');
    const delProfileRes = await db.query('DELETE FROM alumni_profiles WHERE user_id = $1', [testUserId]);
    assert(delProfileRes.rowCount === 1, `Deleted Alumni Profile (User ID: ${testUserId})`);

    const delUserRes = await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
    assert(delUserRes.rowCount === 1, `Deleted User (ID: ${testUserId})`);

    const delChapterRes = await db.query('DELETE FROM chapters WHERE id = $1', [testChapterId]);
    assert(delChapterRes.rowCount === 1, `Deleted Chapter (ID: ${testChapterId})`);

    const delStoryRes = await db.query('DELETE FROM stories WHERE id = $1', [testStoryId]);
    assert(delStoryRes.rowCount === 1, `Deleted Story (ID: ${testStoryId})`);

    // ─── TEST 6: VERIFY CLEANUP ───
    console.log('\n6️⃣ Verifying Cleanup & Final State...');
    const verifyUser = await db.query('SELECT * FROM users WHERE id = $1', [testUserId]);
    assert(verifyUser.rows.length === 0, `Confirmed User deleted (Count: 0)`);

    const verifyChapter = await db.query('SELECT * FROM chapters WHERE id = $1', [testChapterId]);
    assert(verifyChapter.rows.length === 0, `Confirmed Chapter deleted (Count: 0)`);

    console.log(`\n==================================================`);
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED.`);
    console.log(`==================================================\n`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('❌ CRUD Test Error:', err);
    process.exit(1);
  }
}

runCrudTests();
