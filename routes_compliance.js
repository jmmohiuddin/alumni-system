/* ============================================================
   DIC ALUMNI PLATFORM — COMPLIANCE ROUTES (REQ-14)
   PDPA 2026 & Cybersecurity Act 2023.

   The UI previously displayed green "compliant" pills over features that did
   not exist: decryptVaultField() revealed a hardcoded string, there was no
   consent log, and DSAR export/delete were toast messages. These endpoints
   implement the behaviour those claims describe.
   ============================================================ */

const db = require('./db');

module.exports = function mountCompliance(app, {
  requireAuth, requireRole, ADMIN_ROLES,
  encryptField, decryptField, encryptionReady, writeAudit
}) {

  const ok = (res, fn) => fn().catch(err => res.status(500).json({ error: err.message }));

  const clientIp = (req) =>
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress || 'unknown';

  /* ─── CONSENT LOGGING ───
     PDPA 2026 requires IP, timestamp and policy version behind each consent. */

  app.post('/api/consent', requireAuth, (req, res) => ok(res, async () => {
    const { consentType, granted, policyVersion } = req.body || {};
    if (!consentType) return res.status(400).json({ error: 'consentType is required' });

    const row = await db.query(`
      INSERT INTO consent_logs (user_id, consent_type, granted, policy_version, ip_address, user_agent)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [req.user.uid, consentType, granted !== false,
        policyVersion || 'PDPA-2026.1', clientIp(req), req.headers['user-agent'] || null]);

    await writeAudit('Consent Recorded',
      `user ${req.user.uid} ${granted !== false ? 'granted' : 'withdrew'} "${consentType}"`, '📜');
    res.json({ success: true, consent: row.rows[0] });
  }));

  app.get('/api/consent', requireAuth, (req, res) => ok(res, async () => {
    const rows = await db.query(
      'SELECT * FROM consent_logs WHERE user_id=$1 ORDER BY created_at DESC', [req.user.uid]);
    res.json(rows.rows);
  }));

  /* ─── ENCRYPTED IDENTITY VAULT (AES-256-GCM) ─── */

  app.get('/api/vault', requireRole(...ADMIN_ROLES), (req, res) => ok(res, async () => {
    // Masked view: never decrypts. last_four is stored alongside the ciphertext
    // so the list can render without touching the key.
    const rows = await db.query(`
      SELECT v.id, v.field_type, v.last_four, v.created_at,
             u.id AS user_id, u.full_name AS owner_name
      FROM identity_vault v JOIN users u ON u.id = v.user_id
      ORDER BY v.created_at DESC LIMIT 50
    `);
    res.json({ encryptionEnabled: encryptionReady, entries: rows.rows });
  }));

  app.post('/api/vault', requireAuth, (req, res) => ok(res, async () => {
    if (!encryptionReady) {
      return res.status(503).json({ error: 'Encryption key not configured — refusing to store identity data.' });
    }
    const { fieldType, value } = req.body || {};
    if (!['nid', 'brc', 'passport'].includes(fieldType)) {
      return res.status(400).json({ error: 'fieldType must be nid, brc or passport' });
    }
    if (!value || !String(value).trim()) return res.status(400).json({ error: 'A value is required' });

    const plain = String(value).trim();
    const { ciphertext, iv, authTag } = encryptField(plain);

    const row = await db.query(`
      INSERT INTO identity_vault (user_id, field_type, ciphertext, iv, auth_tag, last_four)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (user_id, field_type) DO UPDATE
        SET ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv,
            auth_tag=EXCLUDED.auth_tag, last_four=EXCLUDED.last_four
      RETURNING id, field_type, last_four, created_at
    `, [req.user.uid, fieldType, ciphertext, iv, authTag, plain.slice(-4)]);

    await writeAudit('Identity Field Encrypted',
      `${fieldType.toUpperCase()} stored for user ${req.user.uid} (AES-256-GCM)`, '🔐');
    res.json({ success: true, entry: row.rows[0] });
  }));

  // Decryption is privileged, requires a stated reason, and is itself logged.
  app.post('/api/vault/:id/reveal', requireRole(...ADMIN_ROLES), (req, res) => ok(res, async () => {
    if (!encryptionReady) return res.status(503).json({ error: 'Encryption key not configured' });

    const { reason } = req.body || {};
    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'A reason (min 5 characters) is required to decrypt identity data' });
    }

    const row = await db.query(`
      SELECT v.*, u.full_name FROM identity_vault v
      JOIN users u ON u.id = v.user_id WHERE v.id = $1
    `, [parseInt(req.params.id)]);
    if (!row.rows.length) return res.status(404).json({ error: 'Vault entry not found' });

    let plaintext;
    try {
      plaintext = decryptField(row.rows[0]);
    } catch {
      // GCM auth tag mismatch means the ciphertext or key changed.
      return res.status(500).json({ error: 'Decryption failed — data integrity check did not pass' });
    }

    await db.query('INSERT INTO vault_access_logs (vault_id, accessed_by, reason) VALUES ($1,$2,$3)',
      [row.rows[0].id, req.user.uid, reason.trim()]);
    await writeAudit('Identity Field Decrypted',
      `${row.rows[0].field_type.toUpperCase()} of ${row.rows[0].full_name} by user ${req.user.uid} — "${reason.trim()}"`, '🔓');

    res.json({ value: plaintext, owner: row.rows[0].full_name, fieldType: row.rows[0].field_type });
  }));

  app.get('/api/vault/access-logs', requireRole(...ADMIN_ROLES), (req, res) => ok(res, async () => {
    const rows = await db.query(`
      SELECT l.*, u.full_name AS accessed_by_name, v.field_type, o.full_name AS owner_name
      FROM vault_access_logs l
      LEFT JOIN users u ON u.id = l.accessed_by
      LEFT JOIN identity_vault v ON v.id = l.vault_id
      LEFT JOIN users o ON o.id = v.user_id
      ORDER BY l.created_at DESC LIMIT 50
    `);
    res.json(rows.rows);
  }));

  /* ─── DSAR: STRUCTURED EXPORT (JSON / CSV) ─── */

  app.get('/api/dsar/export', requireAuth, (req, res) => ok(res, async () => {
    const uid = req.user.uid;
    const format = (req.query.format || 'json').toLowerCase();

    const [user, profile, donations, registrations, mentorships, memberships, consents, stories] =
      await Promise.all([
        db.query('SELECT id, email, full_name, role, department, created_at FROM users WHERE id=$1', [uid]),
        db.query('SELECT * FROM alumni_profiles WHERE user_id=$1', [uid]),
        db.query('SELECT amount, currency, payment_gateway, status, receipt_code, created_at FROM donations WHERE donor_user_id=$1', [uid]),
        db.query('SELECT ticket_code, status, checked_in, created_at FROM event_registrations WHERE user_id=$1', [uid]),
        db.query('SELECT subject, status, created_at FROM mentorships WHERE mentor_id=$1 OR mentee_id=$1', [uid]),
        db.query('SELECT chapter_id, joined_at FROM chapter_memberships WHERE user_id=$1', [uid]),
        db.query('SELECT consent_type, granted, policy_version, created_at FROM consent_logs WHERE user_id=$1', [uid]),
        db.query('SELECT title, status, created_at FROM stories WHERE author_id=$1', [uid])
      ]);

    const bundle = {
      exportedAt: new Date().toISOString(),
      policyVersion: 'PDPA-2026.1',
      subject: user.rows[0] || null,
      profile: profile.rows[0] || null,
      donations: donations.rows,
      eventRegistrations: registrations.rows,
      mentorships: mentorships.rows,
      chapterMemberships: memberships.rows,
      consentHistory: consents.rows,
      stories: stories.rows
    };

    await writeAudit('DSAR Export', `user ${uid} exported their data as ${format.toUpperCase()}`, '📦');

    if (format === 'csv') {
      // Flatten each section into its own labelled block.
      const lines = [];
      for (const [section, value] of Object.entries(bundle)) {
        if (Array.isArray(value)) {
          lines.push(`# ${section}`);
          if (value.length) {
            lines.push(Object.keys(value[0]).join(','));
            value.forEach(r => lines.push(Object.values(r)
              .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')));
          }
          lines.push('');
        } else if (value && typeof value === 'object') {
          lines.push(`# ${section}`);
          lines.push(Object.keys(value).join(','));
          lines.push(Object.values(value).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
          lines.push('');
        }
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="dic_dsar_export_${uid}.csv"`);
      return res.send(lines.join('\n'));
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="dic_dsar_export_${uid}.json"`);
    res.send(JSON.stringify(bundle, null, 2));
  }));

  /* ─── DSAR: ACCOUNT DELETION WITH 30-DAY GRACE ─── */

  app.post('/api/dsar/delete', requireAuth, (req, res) => ok(res, async () => {
    const existing = await db.query(
      `SELECT * FROM deletion_requests WHERE user_id=$1 AND status='pending'`, [req.user.uid]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'A deletion request is already pending', request: existing.rows[0] });
    }
    const row = await db.query(
      'INSERT INTO deletion_requests (user_id, reason) VALUES ($1,$2) RETURNING *',
      [req.user.uid, req.body?.reason || null]);

    await writeAudit('Account Deletion Requested',
      `user ${req.user.uid}; purge scheduled ${row.rows[0].purge_after}`, '⚠');
    await db.query(`INSERT INTO notifications (user_id, icon, title, subtitle) VALUES ($1,'⚠','Account Deletion Scheduled',$2)`,
      [req.user.uid, 'Your account is scheduled for deletion in 30 days. You can cancel any time before then.']);

    res.json({ success: true, request: row.rows[0] });
  }));

  app.get('/api/dsar/delete', requireAuth, (req, res) => ok(res, async () => {
    const row = await db.query(
      `SELECT * FROM deletion_requests WHERE user_id=$1 AND status='pending'`, [req.user.uid]);
    res.json(row.rows[0] || null);
  }));

  app.delete('/api/dsar/delete', requireAuth, (req, res) => ok(res, async () => {
    const row = await db.query(
      `UPDATE deletion_requests SET status='cancelled' WHERE user_id=$1 AND status='pending' RETURNING *`,
      [req.user.uid]);
    if (!row.rows.length) return res.status(404).json({ error: 'No pending deletion request' });
    await writeAudit('Account Deletion Cancelled', `user ${req.user.uid}`, '↩');
    res.json({ success: true });
  }));

  /* ─── COMPLIANCE STATUS ───
     Drives the admin panel pills from reality instead of hardcoded green. */

  app.get('/api/compliance/status', requireRole(...ADMIN_ROLES), (req, res) => ok(res, async () => {
    const [vault, consents, deletions, audits, access] = await Promise.all([
      db.query('SELECT COUNT(*)::int n FROM identity_vault'),
      db.query('SELECT COUNT(*)::int n FROM consent_logs'),
      db.query(`SELECT COUNT(*)::int n FROM deletion_requests WHERE status='pending'`),
      db.query('SELECT COUNT(*)::int n FROM audit_logs'),
      db.query('SELECT COUNT(*)::int n FROM vault_access_logs')
    ]);

    res.json([
      {
        icon: '🔐', title: 'AES-256-GCM Field Encryption',
        desc: encryptionReady
          ? `Active. ${vault.rows[0].n} identity field(s) encrypted at the application layer.`
          : 'INACTIVE — ENCRYPTION_KEY is not configured. Identity storage is refused.',
        status: encryptionReady ? 'compliant' : 'at_risk'
      },
      {
        icon: '📜', title: 'Consent Logging (PDPA 2026)',
        desc: `${consents.rows[0].n} consent event(s) recorded with IP, timestamp and policy version.`,
        status: consents.rows[0].n > 0 ? 'compliant' : 'pending'
      },
      {
        icon: '🛡', title: 'Immutable Audit Trail (CA 2023)',
        desc: `${audits.rows[0].n} hash-chained entries; ${access.rows[0].n} vault access record(s).`,
        status: audits.rows[0].n > 0 ? 'compliant' : 'pending'
      },
      {
        icon: '📦', title: 'Data Subject Rights (DSAR)',
        desc: `JSON/CSV export active. ${deletions.rows[0].n} deletion request(s) in the 30-day grace window.`,
        status: 'compliant'
      }
    ]);
  }));
};
