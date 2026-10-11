/* ============================================================
   DAFFODIL INTERNATIONAL COLLEGE (DIC) ALUMNI PLATFORM
   Migration: move the hardcoded frontend alumni dataset into PostgreSQL.

   The directory used to render a MOCK_ALUMNI array baked into app.js while the
   database held almost no profiles. This script upserts that dataset as real
   users + alumni_profiles rows so the directory can be served from PG.

   Idempotent — safe to re-run. Usage:  node migrate_alumni.js
   ============================================================ */

const db = require('./db');

const ALUMNI = [
  { name: 'Fatima Khanam',   initials: 'FK', title: 'Senior Software Engineer', company: 'bKash Ltd',          batch: 2019, dept: 'CSE', domain: 'tech',     city: 'Dhaka',    country: 'Bangladesh', skills: 'React, Node.js, AWS',                    mentor: true,  color: '#00A859' },
  { name: 'Arif Hossain',    initials: 'AH', title: 'Data Scientist',           company: 'Pathao',             batch: 2018, dept: 'SWE', domain: 'tech',     city: 'Dhaka',    country: 'Bangladesh', skills: 'Python, ML, TensorFlow',                 mentor: true,  color: '#00D4AA' },
  { name: 'Nusrat Jahan',    initials: 'NJ', title: 'Investment Analyst',       company: 'BRAC Bank',          batch: 2020, dept: 'BBA', domain: 'finance',  city: 'Dhaka',    country: 'Bangladesh', skills: 'Finance, Excel, Bloomberg',              mentor: false, color: '#C084FC' },
  { name: 'Tanvir Ahmed',    initials: 'TA', title: 'Product Manager',          company: 'Brain Station 23',   batch: 2017, dept: 'CSE', domain: 'tech',     city: 'Dhaka',    country: 'Bangladesh', skills: 'Agile, Product, Analytics',              mentor: true,  color: '#FF8C42' },
  { name: 'Ruma Begum',      initials: 'RB', title: 'DevOps Engineer',          company: 'Nagad',              batch: 2019, dept: 'SWE', domain: 'tech',     city: 'Dhaka',    country: 'Bangladesh', skills: 'Docker, K8s, CI/CD',                     mentor: false, color: '#34D399' },
  { name: 'Sakib Al Hassan', initials: 'SH', title: 'Cybersecurity Lead',       company: 'Dutch-Bangla Bank',  batch: 2016, dept: 'CSE', domain: 'tech',     city: 'Dhaka',    country: 'Bangladesh', skills: 'Security, Pentest, SIEM',                mentor: true,  color: '#F87171' },
  { name: 'Priya Das',       initials: 'PD', title: 'UX Designer',              company: 'SSL Wireless',       batch: 2021, dept: 'CSE', domain: 'design',   city: 'Dhaka',    country: 'Bangladesh', skills: 'Figma, UX Research, Design Systems',     mentor: false, color: '#00A859' },
  { name: 'Khalid Mahmud',   initials: 'KM', title: 'Backend Engineer',         company: 'Chaldal',            batch: 2020, dept: 'CSE', domain: 'tech',     city: 'Dhaka',    country: 'Bangladesh', skills: 'Go, PostgreSQL, Redis',                  mentor: true,  color: '#00D4AA' },
  { name: 'Sadia Islam',     initials: 'SI', title: 'Business Analyst',         company: 'Unilever BD',        batch: 2018, dept: 'BBA', domain: 'business', city: 'Dhaka',    country: 'Bangladesh', skills: 'Strategy, Analytics, SQL',               mentor: false, color: '#C084FC' },
  { name: 'Rezaul Karim',    initials: 'RK', title: 'ML Research Engineer',     company: 'Samsung R&D BD',     batch: 2017, dept: 'CSE', domain: 'tech',     city: 'Dhaka',    country: 'Bangladesh', skills: 'ML, NLP, Computer Vision',               mentor: true,  color: '#FF8C42' },
  { name: 'Tasnim Akter',    initials: 'TA', title: 'Software Engineer',        company: 'Google',             batch: 2015, dept: 'CSE', domain: 'tech',     city: 'London',   country: 'United Kingdom', skills: 'Python, Go, Distributed Systems',    mentor: true,  color: '#34D399' },
  { name: 'Imran Hossain',   initials: 'IH', title: 'Quant Developer',          company: 'Goldman Sachs',      batch: 2014, dept: 'EEE', domain: 'finance',  city: 'New York', country: 'United States', skills: 'C++, Quant Finance, Python',          mentor: false, color: '#F87171' }
];

const DEPT_NAMES = {
  CSE: 'Computer Science & Engineering',
  SWE: 'Software Engineering',
  BBA: 'Business Administration',
  EEE: 'Electrical & Electronic Engineering'
};

function emailFor(name) {
  return name.toLowerCase().replace(/[^a-z]+/g, '.') + '@dic.edu.bd';
}

async function run() {
  let created = 0, updated = 0;

  // Remove throwaway rows left behind by earlier end-to-end test runs.
  const purged = await db.query("DELETE FROM alumni_profiles WHERE student_id LIKE 'DIC-TEST-%' RETURNING id");
  const purgedUsers = await db.query("DELETE FROM users WHERE email LIKE 'test_crud_%@dic.edu.bd' RETURNING id");
  if (purged.rowCount || purgedUsers.rowCount) {
    console.log(`🧹 Removed ${purgedUsers.rowCount} test user(s) and ${purged.rowCount} test profile(s).`);
  }

  for (const [i, a] of ALUMNI.entries()) {
    const email = emailFor(a.name);
    const studentId = `DIC-${a.batch}-${String(1000 + i)}`;
    const department = DEPT_NAMES[a.dept] || a.dept;

    // users: keyed on email so re-runs update rather than duplicate.
    const userRes = await db.query(`
      INSERT INTO users (email, full_name, initials, role, role_label, department, icon, is_verified)
      VALUES ($1, $2, $3, 'alumni', 'Alumni Member', $4, '🎓', TRUE)
      ON CONFLICT (email) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            initials  = EXCLUDED.initials,
            department = EXCLUDED.department
      RETURNING id, (xmax = 0) AS inserted
    `, [email, a.name, a.initials, department]);

    const userId = userRes.rows[0].id;
    userRes.rows[0].inserted ? created++ : updated++;

    await db.query(`
      INSERT INTO alumni_profiles (
        user_id, student_id, batch, passing_year, department, degree,
        primary_email, mobile_number, city, country,
        current_company, job_title, industry, skills,
        can_mentor, bio, color
      )
      VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (user_id) DO UPDATE SET
        batch = EXCLUDED.batch,
        passing_year = EXCLUDED.passing_year,
        department = EXCLUDED.department,
        current_company = EXCLUDED.current_company,
        job_title = EXCLUDED.job_title,
        industry = EXCLUDED.industry,
        skills = EXCLUDED.skills,
        can_mentor = EXCLUDED.can_mentor,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        color = EXCLUDED.color,
        updated_at = CURRENT_TIMESTAMP
    `, [
      userId, studentId, a.batch, department, `BSc ${a.dept}`,
      email, '+880 1700-000000', a.city, a.country,
      a.company, a.title, a.domain, a.skills,
      a.mentor, `DIC ${department} graduate, batch ${a.batch}. Currently ${a.title} at ${a.company}.`, a.color
    ]);
  }

  console.log(`✅ Alumni directory migrated: ${created} created, ${updated} updated.`);

  const total = await db.query(`
    SELECT COUNT(*)::int n FROM users u JOIN alumni_profiles ap ON ap.user_id = u.id
  `);
  console.log(`📊 Directory now serves ${total.rows[0].n} profiles from PostgreSQL.`);
}

run()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌ Migration failed:', err.message); process.exit(1); });
