-- ============================================================
-- DIC ALUMNI PLATFORM — SCHEMA v2
-- Tables the application needed but never had. Additive only:
-- nothing here drops or alters an existing v1 table.
-- Run with:  node migrate_v2.js
-- ============================================================

-- ─── 1. DONATIONS LEDGER (REQ-05) ───
-- The PRD specified this table; the app had no donations storage at all.
CREATE TABLE IF NOT EXISTS donations (
    id SERIAL PRIMARY KEY,
    campaign_id INT REFERENCES campaigns(id) ON DELETE SET NULL,
    donor_user_id INT REFERENCES users(id) ON DELETE SET NULL,
    donor_name VARCHAR(150),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
    payment_gateway VARCHAR(50) NOT NULL,
    transaction_reference VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
    is_anonymous BOOLEAN DEFAULT FALSE,
    receipt_code VARCHAR(100),
    failure_reason TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_donations_campaign ON donations(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_user_id);

-- ─── 2. EVENT REGISTRATIONS & TICKETS (REQ-06) ───
CREATE TABLE IF NOT EXISTS event_registrations (
    id SERIAL PRIMARY KEY,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_code VARCHAR(100) UNIQUE NOT NULL,
    qr_payload TEXT NOT NULL,
    ticket_type VARCHAR(50) DEFAULT 'standard',
    amount_paid NUMERIC(12,2) DEFAULT 0,
    payment_gateway VARCHAR(50),
    donation_id INT REFERENCES donations(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'waitlisted', 'cancelled')),
    checked_in BOOLEAN DEFAULT FALSE,
    checked_in_at TIMESTAMP WITH TIME ZONE,
    checked_in_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- One ticket per person per event; makes duplicate registration impossible
    -- at the database level rather than relying on application checks.
    UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_registrations_event ON event_registrations(event_id, status);

-- ─── 3. MENTORSHIP (REQ-04) ───
CREATE TABLE IF NOT EXISTS mentorships (
    id SERIAL PRIMARY KEY,
    mentor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mentee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    message TEXT,
    match_score INT DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'completed')),
    -- REQ-04: unanswered requests auto-expire after 5 calendar days.
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '5 days'),
    responded_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    health_score INT DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (mentor_id <> mentee_id)
);
CREATE INDEX IF NOT EXISTS idx_mentorships_mentor ON mentorships(mentor_id, status);
CREATE INDEX IF NOT EXISTS idx_mentorships_mentee ON mentorships(mentee_id, status);

-- ─── 4. ALUMNI CONNECTIONS ───
CREATE TABLE IF NOT EXISTS connections (
    id SERIAL PRIMARY KEY,
    requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);

-- ─── 5. JOB APPLICATIONS & REFERRALS (REQ-07) ───
CREATE TABLE IF NOT EXISTS job_applications (
    id SERIAL PRIMARY KEY,
    job_id INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    applicant_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cover_note TEXT,
    resume_url VARCHAR(500),
    status VARCHAR(50) NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'reviewing', 'shortlisted', 'rejected', 'hired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, applicant_id)
);

CREATE TABLE IF NOT EXISTS job_referrals (
    id SERIAL PRIMARY KEY,
    job_id INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referrer_id INT REFERENCES users(id) ON DELETE SET NULL,
    message TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 6. EVENT PLANNER — MISSING MODULES (Phase 6) ───
CREATE TABLE IF NOT EXISTS event_vendors (
    id SERIAL PRIMARY KEY,
    event_id INT DEFAULT 1,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) DEFAULT 'General',
    contact_person VARCHAR(150),
    phone VARCHAR(50),
    email VARCHAR(255),
    contract_value NUMERIC(12,2) DEFAULT 0,
    rating INT DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
    status VARCHAR(50) DEFAULT 'shortlisted'
        CHECK (status IN ('shortlisted', 'contracted', 'paid', 'rejected')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_timeline (
    id SERIAL PRIMARY KEY,
    event_id INT DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    phase VARCHAR(100) DEFAULT 'planning',
    starts_at DATE,
    ends_at DATE,
    owner VARCHAR(150),
    progress INT DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    status VARCHAR(50) DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'done', 'delayed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_logistics (
    id SERIAL PRIMARY KEY,
    event_id INT DEFAULT 1,
    item VARCHAR(255) NOT NULL,
    category VARCHAR(100) DEFAULT 'Venue',
    quantity INT DEFAULT 1,
    location VARCHAR(255),
    responsible VARCHAR(150),
    status VARCHAR(50) DEFAULT 'planned'
        CHECK (status IN ('planned', 'arranged', 'on_site', 'returned')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_marketing (
    id SERIAL PRIMARY KEY,
    event_id INT DEFAULT 1,
    channel VARCHAR(100) NOT NULL,
    campaign_name VARCHAR(255) NOT NULL,
    audience VARCHAR(255),
    budget NUMERIC(12,2) DEFAULT 0,
    reach INT DEFAULT 0,
    conversions INT DEFAULT 0,
    scheduled_for DATE,
    status VARCHAR(50) DEFAULT 'planned'
        CHECK (status IN ('planned', 'live', 'completed', 'paused')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_meetings (
    id SERIAL PRIMARY KEY,
    event_id INT DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    agenda TEXT,
    meeting_date DATE,
    meeting_time VARCHAR(50),
    location VARCHAR(255),
    attendees TEXT,
    minutes TEXT,
    status VARCHAR(50) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'held', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 7. BROADCASTS (REQ-12) ───
CREATE TABLE IF NOT EXISTS broadcasts (
    id SERIAL PRIMARY KEY,
    sender_id INT REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    channels TEXT[] NOT NULL DEFAULT ARRAY['push'],
    target_role VARCHAR(50),
    target_batch INT,
    recipients_count INT DEFAULT 0,
    delivered_count INT DEFAULT 0,
    read_count INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 8. POLLS (news feed) ───
CREATE TABLE IF NOT EXISTS polls (
    id SERIAL PRIMARY KEY,
    question VARCHAR(255) NOT NULL,
    options TEXT[] NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    closes_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS poll_votes (
    id SERIAL PRIMARY KEY,
    poll_id INT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    option_index INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (poll_id, user_id)   -- one vote per person, enforced by the database
);

-- ─── 9. COMPLIANCE: CONSENT LOG & ENCRYPTED IDENTITY VAULT (REQ-14) ───
-- PDPA 2026 requires the IP, timestamp and policy version behind each consent.
CREATE TABLE IF NOT EXISTS consent_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    consent_type VARCHAR(100) NOT NULL,
    granted BOOLEAN NOT NULL,
    policy_version VARCHAR(50) NOT NULL DEFAULT 'PDPA-2026.1',
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- NID/BRC are stored as AES-256-GCM ciphertext only. The plaintext never
-- touches a column: iv + auth_tag are needed to decrypt, and the last-4 digits
-- are kept separately so the UI can show a masked value without decrypting.
CREATE TABLE IF NOT EXISTS identity_vault (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    field_type VARCHAR(20) NOT NULL CHECK (field_type IN ('nid', 'brc', 'passport')),
    ciphertext TEXT NOT NULL,
    iv VARCHAR(64) NOT NULL,
    auth_tag VARCHAR(64) NOT NULL,
    last_four VARCHAR(8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, field_type)
);

-- Every decrypt is itself an auditable event.
CREATE TABLE IF NOT EXISTS vault_access_logs (
    id SERIAL PRIMARY KEY,
    vault_id INT REFERENCES identity_vault(id) ON DELETE CASCADE,
    accessed_by INT REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 10. DSAR: ACCOUNT DELETION WITH 30-DAY GRACE (REQ-14) ───
CREATE TABLE IF NOT EXISTS deletion_requests (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'cancelled', 'completed')),
    purge_after TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 11. OUTBOX FOR OFFLINE SYNC CONFLICT RESOLUTION (REQ-10) ───
-- Immutable write log. A replayed offline mutation carries its client_mutation_id;
-- the unique index makes duplicate check-ins idempotent rather than double-counted.
CREATE TABLE IF NOT EXISTS sync_mutations (
    id SERIAL PRIMARY KEY,
    client_mutation_id VARCHAR(100) UNIQUE NOT NULL,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    entity VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    payload JSONB,
    applied BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 12. INDEXES ON EXISTING v1 TABLES ───
-- These lookups all ran as sequential scans.
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_profiles_batch ON alumni_profiles(batch);
CREATE INDEX IF NOT EXISTS idx_profiles_dept ON alumni_profiles(department);
CREATE INDEX IF NOT EXISTS idx_profiles_mentor ON alumni_profiles(can_mentor) WHERE can_mentor = TRUE;
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(status);
CREATE INDEX IF NOT EXISTS idx_notifications_scope ON notifications(user_id, target_role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON chapter_memberships(user_id);
