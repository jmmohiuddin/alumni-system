-- ============================================================
-- DIC ALUMNI PLATFORM — SCHEMA v3
-- Profile fields required by the DIC Alumni Reunion 2026 CSV import.
--
-- Only genuinely-missing columns are added. Eight of the twelve fields the
-- CSV carries already existed and are reused rather than duplicated:
--   Blood Group                 -> alumni_profiles.blood_group
--   Institution / Organization  -> alumni_profiles.current_company
--   Designation                 -> alumni_profiles.job_title
--   HSC Passing Year            -> alumni_profiles.passing_year (+ batch)
--   Present Address             -> alumni_profiles.present_address
--   Facebook Profile Link       -> alumni_profiles.facebook
--   Mobile Number               -> alumni_profiles.mobile_number
--   Name / Email                -> users.full_name / users.email
--
-- Run with:  node migrate_v3.js
-- ============================================================

-- Occupation category (Student / Job / Business / Others). No prior column
-- existed — current_company and job_title describe the employer and the title,
-- not the employment category.
ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS occupation VARCHAR(100);

-- HSC academic group (Science / Business Studies / Humanities).
ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS hsc_group VARCHAR(60);

-- HSC medium of instruction (Bangla / English version).
ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS hsc_version VARCHAR(30);

-- Profile photo URL supplied by the intake form.
ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500);

-- Forces a password change on first login for bulk-imported accounts, which
-- all share the same initial credential.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- Records how an account was created so imported rows are distinguishable
-- from self-registered ones.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_via VARCHAR(30) DEFAULT 'manual';

-- student_id is NOT NULL UNIQUE in v1, but the reunion CSV has no student ID
-- column. Relax it so imports can proceed; generated placeholders remain
-- unique per user.
ALTER TABLE alumni_profiles ALTER COLUMN student_id DROP NOT NULL;

-- Dedup lookups used by the importer.
CREATE INDEX IF NOT EXISTS idx_profiles_mobile ON alumni_profiles(mobile_number);
CREATE INDEX IF NOT EXISTS idx_profiles_occupation ON alumni_profiles(occupation);
CREATE INDEX IF NOT EXISTS idx_profiles_hsc_group ON alumni_profiles(hsc_group);
