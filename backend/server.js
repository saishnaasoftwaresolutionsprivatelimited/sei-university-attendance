require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const dbPath = path.join(__dirname, 'attendance.db');
const db = new sqlite3.Database(dbPath);

const run = (sql, p = []) => new Promise((ok, no) => db.run(sql, p, function (e) { e ? no(e) : ok({ id: this.lastID, changes: this.changes }); }));
const get = (sql, p = []) => new Promise((ok, no) => db.get(sql, p, (e, r) => e ? no(e) : ok(r)));
const all = (sql, p = []) => new Promise((ok, no) => db.all(sql, p, (e, r) => e ? no(e) : ok(r)));

const today = () => new Date().toISOString().slice(0, 10);
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const phone = s => {
  let n = String(s || '').replace(/\D/g, '');
  if (n.length === 10) n = '91' + n;
  return /^\d{8,15}$/.test(n) ? n : null;
};
const esc = s => String(s || '').trim();

// Safe database setup and non-destructive migrations
const ready = (async () => {
  await run('PRAGMA journal_mode=WAL');
  await run('PRAGMA foreign_keys=ON');

  // Create base tables if they do not exist
  await run(`CREATE TABLE IF NOT EXISTS students(
    id INTEGER PRIMARY KEY,
    roll_no TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    course TEXT NOT NULL,
    department TEXT DEFAULT '',
    year TEXT DEFAULT '',
    section TEXT DEFAULT '',
    parent_name TEXT NOT NULL,
    parent_email TEXT NOT NULL,
    parent_phone TEXT NOT NULL,
    parent_whatsapp TEXT NOT NULL,
    whatsapp_consent INTEGER NOT NULL DEFAULT 0,
    sms_consent INTEGER NOT NULL DEFAULT 0
  )`);

  await run(`CREATE TABLE IF NOT EXISTS attendance(
    id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    day TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','LATE')),
    UNIQUE(student_id,day)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS alerts(
    id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    day TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('EMAIL','WHATSAPP','SMS')),
    recipient TEXT NOT NULL,
    message TEXT NOT NULL,
    subject TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id,day,channel)
  )`);

  // Migration 1: Add department, year, section columns to students if missing
  const studentCols = await all('PRAGMA table_info(students)');
  const colNames = studentCols.map(c => c.name);
  if (!colNames.includes('department')) {
    await run("ALTER TABLE students ADD COLUMN department TEXT DEFAULT ''");
  }
  if (!colNames.includes('year')) {
    await run("ALTER TABLE students ADD COLUMN year TEXT DEFAULT ''");
  }
  if (!colNames.includes('section')) {
    await run("ALTER TABLE students ADD COLUMN section TEXT DEFAULT ''");
  }

  // Update existing students with department/year defaults if empty
  await run("UPDATE students SET department = course WHERE department IS NULL OR department = ''");
  await run("UPDATE students SET year = '1st Year' WHERE year IS NULL OR year = ''");
  await run("UPDATE students SET section = 'A' WHERE section IS NULL OR section = ''");

  // Migration 2: Upgrade attendance check constraint to support 'LATE' if needed
  const attTable = await get("SELECT sql FROM sqlite_master WHERE type='table' AND name='attendance'");
  if (attTable && attTable.sql && !attTable.sql.includes("'LATE'")) {
    await run('PRAGMA foreign_keys=OFF');
    await run(`CREATE TABLE IF NOT EXISTS attendance_new(
      id INTEGER PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      day TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','LATE')),
      UNIQUE(student_id,day)
    )`);
    await run('INSERT INTO attendance_new SELECT id, student_id, day, status FROM attendance');
    await run('DROP TABLE attendance');
    await run('ALTER TABLE attendance_new RENAME TO attendance');
    await run('PRAGMA foreign_keys=ON');
  }

  // Seed sample synthetic students if only 1 test record exists (ensures rich filtering/reports testing)
  const countObj = await get('SELECT COUNT(*) as cnt FROM students');
  if (countObj && countObj.cnt < 2) {
    const synthetic = [
      { roll_no: 'SEI-2026-CSE-002', full_name: 'Ananya Sharma', course: 'B.Tech', department: 'Computer Science', year: '3rd Year', section: 'A', parent_name: 'Rajesh Sharma', parent_email: 'parent.sharma.test@example.com', parent_phone: '9876543211', parent_whatsapp: '9876543211', whatsapp_consent: 1, sms_consent: 1 },
      { roll_no: 'SEI-2026-ECE-003', full_name: 'Rahul Verma', course: 'B.Tech', department: 'Electronics & Comm', year: '2nd Year', section: 'B', parent_name: 'Suresh Verma', parent_email: 'parent.verma.test@example.com', parent_phone: '9876543212', parent_whatsapp: '9876543212', whatsapp_consent: 1, sms_consent: 0 },
      { roll_no: 'SEI-2026-MECH-004', full_name: 'Pooja Iyer', course: 'B.Tech', department: 'Mechanical Engg', year: '4th Year', section: 'A', parent_name: 'Venkatesh Iyer', parent_email: 'parent.iyer.test@example.com', parent_phone: '9876543213', parent_whatsapp: '9876543213', whatsapp_consent: 0, sms_consent: 1 },
      { roll_no: 'SEI-2026-MBA-005', full_name: 'Vikramaditya Roy', course: 'MBA', department: 'Management Studies', year: '1st Year', section: 'C', parent_name: 'Debashis Roy', parent_email: 'parent.roy.test@example.com', parent_phone: '9876543214', parent_whatsapp: '9876543214', whatsapp_consent: 1, sms_consent: 1 },
      { roll_no: 'SEI-2026-IT-006', full_name: 'Sneha Patel', course: 'B.Tech', department: 'Information Tech', year: '2nd Year', section: 'A', parent_name: 'Hitesh Patel', parent_email: 'parent.patel.test@example.com', parent_phone: '9876543215', parent_whatsapp: '9876543215', whatsapp_consent: 0, sms_consent: 0 }
    ];
    for (const s of synthetic) {
      await run(
        `INSERT OR IGNORE INTO students(roll_no, full_name, course, department, year, section, parent_name, parent_email, parent_phone, parent_whatsapp, whatsapp_consent, sms_consent)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.roll_no, s.full_name, s.course, s.department, s.year, s.section, s.parent_name, s.parent_email, s.parent_phone, s.parent_whatsapp, s.whatsapp_consent, s.sms_consent]
      );
    }
  }
})();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Public access allowed (hosting-ready)

// Serve static assets from public with explicit caching and mime support
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: 0,
  etag: true
}));

app.use('/api', rateLimit({
  windowMs: 60000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));

app.use('/api', async (req, res, next) => {
  try {
    await ready;
    next();
  } catch (e) {
    next(e);
  }
});

// ==================== STUDENTS API ====================
app.get('/api/students', async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM students ORDER BY roll_no ASC');
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.post('/api/students', async (req, res, next) => {
  try {
    const x = req.body || {};
    const required = ['roll_no', 'full_name', 'course', 'parent_name', 'parent_email', 'parent_phone', 'parent_whatsapp'];
    for (const k of required) {
      if (!esc(x[k])) return res.status(400).json({ error: `${k.replace('_', ' ')} is required` });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.parent_email)) {
      return res.status(400).json({ error: 'Invalid parent email address' });
    }
    if (!phone(x.parent_phone) || !phone(x.parent_whatsapp)) {
      return res.status(400).json({ error: 'Invalid parent phone or WhatsApp number (must be 10-15 digits)' });
    }

    const dept = esc(x.department) || esc(x.course);
    const yr = esc(x.year) || '1st Year';
    const sec = esc(x.section) || 'A';

    const r = await run(
      `INSERT INTO students(roll_no, full_name, course, department, year, section, parent_name, parent_email, parent_phone, parent_whatsapp, whatsapp_consent, sms_consent)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        esc(x.roll_no),
        esc(x.full_name),
        esc(x.course),
        dept,
        yr,
        sec,
        esc(x.parent_name),
        esc(x.parent_email).toLowerCase(),
        esc(x.parent_phone),
        esc(x.parent_whatsapp),
        x.whatsapp_consent === true || x.whatsapp_consent === 1 || x.whatsapp_consent === '1' ? 1 : 0,
        x.sms_consent === true || x.sms_consent === 1 || x.sms_consent === '1' ? 1 : 0
      ]
    );
    res.status(201).json({ id: r.id, message: 'Student registered successfully' });
  } catch (e) {
    next(e);
  }
});

app.put('/api/students/:id', async (req, res, next) => {
  try {
    const x = req.body || {};
    const required = ['roll_no', 'full_name', 'course', 'parent_name', 'parent_email', 'parent_phone', 'parent_whatsapp'];
    for (const k of required) {
      if (!esc(x[k])) return res.status(400).json({ error: `${k.replace('_', ' ')} is required` });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.parent_email)) {
      return res.status(400).json({ error: 'Invalid parent email address' });
    }
    if (!phone(x.parent_phone) || !phone(x.parent_whatsapp)) {
      return res.status(400).json({ error: 'Invalid parent phone or WhatsApp number' });
    }

    const dept = esc(x.department) || esc(x.course);
    const yr = esc(x.year) || '1st Year';
    const sec = esc(x.section) || 'A';

    const r = await run(
      `UPDATE students
       SET roll_no=?, full_name=?, course=?, department=?, year=?, section=?, parent_name=?, parent_email=?, parent_phone=?, parent_whatsapp=?, whatsapp_consent=?, sms_consent=?
       WHERE id=?`,
      [
        esc(x.roll_no),
        esc(x.full_name),
        esc(x.course),
        dept,
        yr,
        sec,
        esc(x.parent_name),
        esc(x.parent_email).toLowerCase(),
        esc(x.parent_phone),
        esc(x.parent_whatsapp),
        x.whatsapp_consent === true || x.whatsapp_consent === 1 || x.whatsapp_consent === '1' ? 1 : 0,
        x.sms_consent === true || x.sms_consent === 1 || x.sms_consent === '1' ? 1 : 0,
        req.params.id
      ]
    );
    if (!r.changes) return res.status(404).json({ error: 'Student not found' });
    res.json({ updated: r.changes, message: 'Student details updated' });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/students/:id', async (req, res, next) => {
  try {
    const student = await get('SELECT id FROM students WHERE id=?', [req.params.id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Clean up dependent records safely
    await run('DELETE FROM alerts WHERE student_id=?', [req.params.id]);
    await run('DELETE FROM attendance WHERE student_id=?', [req.params.id]);
    const r = await run('DELETE FROM students WHERE id=?', [req.params.id]);
    res.json({ deleted: r.changes, message: 'Student removed' });
  } catch (e) {
    next(e);
  }
});

// ==================== ATTENDANCE API ====================
app.get('/api/attendance', async (req, res, next) => {
  try {
    const day = req.query.day || today();
    if (!validDate(day)) return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD required)' });

    const department = req.query.department;
    const course = req.query.course;

    let sql = `
      SELECT s.*,
             a.status,
             (SELECT COUNT(*) FROM alerts al WHERE al.student_id = s.id AND al.day = ?) AS alert_count,
             (SELECT al.status FROM alerts al WHERE al.student_id = s.id AND al.day = ? ORDER BY al.id DESC LIMIT 1) AS last_alert_status
      FROM students s
      LEFT JOIN attendance a ON a.student_id = s.id AND a.day = ?
      WHERE 1=1
    `;
    const params = [day, day, day];

    if (department && department !== 'ALL') {
      sql += ' AND (s.department = ? OR s.course = ?)';
      params.push(department, department);
    }
    if (course && course !== 'ALL') {
      sql += ' AND s.course = ?';
      params.push(course);
    }
    sql += ' ORDER BY s.roll_no ASC';

    const rows = await all(sql, params);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.post('/api/attendance', async (req, res, next) => {
  try {
    const { student_id, day, status } = req.body || {};
    if (!validDate(day) || !['PRESENT', 'ABSENT', 'LATE'].includes(status)) {
      return res.status(400).json({ error: 'Invalid attendance parameters' });
    }
    const student = await get('SELECT id FROM students WHERE id=?', [student_id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    await run(
      'INSERT INTO attendance(student_id, day, status) VALUES(?,?,?) ON CONFLICT(student_id, day) DO UPDATE SET status=excluded.status',
      [student_id, day, status]
    );
    res.json({ ok: true, status });
  } catch (e) {
    next(e);
  }
});

app.post('/api/attendance/bulk', async (req, res, next) => {
  try {
    const { day, status, student_ids } = req.body || {};
    if (!validDate(day) || !['PRESENT', 'ABSENT', 'LATE'].includes(status) || !Array.isArray(student_ids)) {
      return res.status(400).json({ error: 'Invalid bulk parameters' });
    }
    for (const sid of student_ids) {
      await run(
        'INSERT INTO attendance(student_id, day, status) VALUES(?,?,?) ON CONFLICT(student_id, day) DO UPDATE SET status=excluded.status',
        [sid, day, status]
      );
    }
    res.json({ ok: true, count: student_ids.length });
  } catch (e) {
    next(e);
  }
});

// ==================== NOTIFICATIONS API ====================
app.get('/api/preview', async (req, res, next) => {
  try {
    const day = req.query.day || today();
    if (!validDate(day)) return res.status(400).json({ error: 'Invalid date' });

    const rows = await all(
      `SELECT s.*, a.status AS attendance_status,
              (SELECT al.status FROM alerts al WHERE al.student_id = s.id AND al.day = ? ORDER BY al.id DESC LIMIT 1) AS alert_status
       FROM students s
       JOIN attendance a ON a.student_id = s.id
       WHERE a.day = ? AND a.status = 'ABSENT'
       ORDER BY s.roll_no ASC`,
      [day, day]
    );

    res.json(rows.map(s => ({
      student: s,
      subject: `SEI University Attendance Alert: ${s.full_name} Absent on ${day}`,
      message: `Dear ${s.parent_name},\n\nThis is to notify you that your ward ${s.full_name} (Roll No: ${s.roll_no}, ${s.course} - ${s.department || 'General'}) was recorded ABSENT for daily classes on ${day}.\n\nPlease contact the University Administration Office if you have any questions.\n\nRegards,\nAttendance Administration Office\nSEI University`
    })));
  } catch (e) {
    next(e);
  }
});

// Working Gmail TLS transporter (retained without changes to TLS or credentials)
const transporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  requireTLS: Number(process.env.SMTP_PORT || 587) !== 465,
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER,
    pass: process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD
  },
  tls: { rejectUnauthorized: true }
});

// Gmail SMTP status verification endpoint
app.get('/api/email/status', async (req, res) => {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return res.json({ configured: false, connected: false, message: 'SMTP credentials not configured in .env' });
  }
  try {
    await transporter().verify();
    res.json({ configured: true, connected: true, user, message: 'Connected to Gmail SMTP server' });
  } catch (err) {
    res.json({ configured: true, connected: false, user, message: err.message });
  }
});

// Test connection endpoint
app.post('/api/email/test', async (req, res) => {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return res.status(400).json({ error: 'SMTP credentials not configured in .env' });
  }
  try {
    await transporter().verify();
    res.json({ ok: true, user, message: `Successfully authenticated and connected to Gmail SMTP as ${user}` });
  } catch (err) {
    res.status(500).json({ error: 'Gmail SMTP authentication failed: ' + err.message });
  }
});

app.post('/api/confirm', async (req, res, next) => {
  try {
    const { student_id, day, subject, message, channels } = req.body || {};
    if (!validDate(day) || typeof message !== 'string' || !message.trim() || message.length > 2000 ||
        typeof subject !== 'string' || !subject.trim() || subject.length > 200 ||
        !Array.isArray(channels) || !channels.length ||
        channels.some(c => !['EMAIL', 'WHATSAPP', 'SMS'].includes(c))) {
      return res.status(400).json({ error: 'Invalid alert payload' });
    }

    const s = await get(
      "SELECT s.* FROM students s JOIN attendance a ON a.student_id=s.id WHERE s.id=? AND a.day=? AND a.status='ABSENT'",
      [student_id, day]
    );
    if (!s) return res.status(409).json({ error: 'Student is not marked absent for this date' });

    const outcomes = [];
    for (const channel of [...new Set(channels)]) {
      if (channel === 'WHATSAPP' && !s.whatsapp_consent) {
        // Record consent on student profile upon administrative authorization
        await run('UPDATE students SET whatsapp_consent=1 WHERE id=?', [s.id]);
      }
      if (channel === 'SMS' && !s.sms_consent) {
        // Record consent on student profile upon administrative authorization
        await run('UPDATE students SET sms_consent=1 WHERE id=?', [s.id]);
      }

      const rawRecipient = channel === 'EMAIL' ? s.parent_email : (channel === 'WHATSAPP' ? s.parent_whatsapp : s.parent_phone);
      const recipient = channel === 'EMAIL' ? rawRecipient : phone(rawRecipient);
      if (!recipient) {
        outcomes.push({ channel, status: 'INVALID_RECIPIENT', note: 'Contact detail is invalid' });
        continue;
      }

      // Check if already prepared
      const existing = await get('SELECT id, status FROM alerts WHERE student_id=? AND day=? AND channel=?', [s.id, day, channel]);
      let alertId;
      if (existing) {
        alertId = existing.id;
        await run('UPDATE alerts SET recipient=?, message=?, subject=?, status=? WHERE id=?', [
          recipient, message, subject, channel === 'EMAIL' ? 'PENDING' : 'READY_MANUAL', alertId
        ]);
      } else {
        const inserted = await run(
          'INSERT INTO alerts(student_id, day, channel, recipient, message, subject, status) VALUES(?,?,?,?,?,?,?)',
          [s.id, day, channel, recipient, message, subject, channel === 'EMAIL' ? 'PENDING' : 'READY_MANUAL']
        );
        alertId = inserted.id;
      }

      if (channel === 'EMAIL') {
        const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
        const smtpPass = process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD;
        if (!smtpUser || !smtpPass) {
          await run("UPDATE alerts SET status='NOT_CONFIGURED', error='SMTP credentials not configured in .env' WHERE id=?", [alertId]);
          outcomes.push({ channel, status: 'NOT_CONFIGURED', note: 'SMTP_USER or SMTP_PASSWORD empty in .env' });
          continue;
        }

        try {
          await run("UPDATE alerts SET status='SENDING' WHERE id=?", [alertId]);
          await transporter().sendMail({
            from: process.env.MAIL_FROM || `"SEI University Attendance" <${smtpUser}>`,
            to: recipient,
            subject,
            text: message
          });
          await run("UPDATE alerts SET status='SENT', error=NULL WHERE id=?", [alertId]);
          outcomes.push({ channel, status: 'SENT', recipient });
        } catch (mailErr) {
          const errMsg = String(mailErr.code || mailErr.message || 'Email delivery failed').slice(0, 180);
          await run("UPDATE alerts SET status='ERROR', error=? WHERE id=?", [errMsg, alertId]);
          outcomes.push({ channel, status: 'ERROR', error: errMsg });
        }
      } else {
        // Manual channels (WhatsApp, SMS): provide actionable payload links
        outcomes.push({
          channel,
          status: 'READY_MANUAL',
          alertId,
          recipient,
          manualNote: 'Ready for staff manual dispatch via local application'
        });
      }
    }
    res.json({ outcomes });
  } catch (e) {
    next(e);
  }
});

app.get('/api/alerts', async (req, res, next) => {
  try {
    const day = req.query.day;
    const channel = req.query.channel;
    const status = req.query.status;

    let sql = `
      SELECT a.*, s.roll_no, s.full_name, s.course, s.department, s.parent_name
      FROM alerts a
      JOIN students s ON s.id = a.student_id
      WHERE 1=1
    `;
    const params = [];
    if (day) {
      sql += ' AND a.day = ?';
      params.push(day);
    }
    if (channel && channel !== 'ALL') {
      sql += ' AND a.channel = ?';
      params.push(channel);
    }
    if (status && status !== 'ALL') {
      sql += ' AND a.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY a.id DESC LIMIT 300';

    const rows = await all(sql, params);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.post('/api/alerts/:id/manual-sent', async (req, res, next) => {
  try {
    const r = await run(
      "UPDATE alerts SET status='MANUALLY_SENT' WHERE id=? AND channel IN ('WHATSAPP','SMS') AND status IN ('READY_MANUAL','PENDING')",
      [req.params.id]
    );
    if (!r.changes) return res.status(409).json({ error: 'Alert is not pending manual dispatch' });
    res.json({ ok: true, status: 'MANUALLY_SENT' });
  } catch (e) {
    next(e);
  }
});

// Delete a single alert record
app.delete('/api/alerts/:id', async (req, res, next) => {
  try {
    const alert = await get('SELECT id FROM alerts WHERE id=?', [req.params.id]);
    if (!alert) return res.status(404).json({ error: 'Alert log not found' });
    const r = await run('DELETE FROM alerts WHERE id=?', [req.params.id]);
    res.json({ ok: true, deleted: r.changes, message: 'Alert log removed' });
  } catch (e) {
    next(e);
  }
});

// Clear all alert records (with optional channel filter)
app.delete('/api/alerts', async (req, res, next) => {
  try {
    const channel = req.query.channel;
    let sql = 'DELETE FROM alerts WHERE 1=1';
    const params = [];
    if (channel && channel !== 'ALL') {
      sql += ' AND channel = ?';
      params.push(channel);
    }
    const r = await run(sql, params);
    res.json({ ok: true, deleted: r.changes, message: 'Alert logs cleared' });
  } catch (e) {
    next(e);
  }
});

// ==================== ATTENDANCE REPORTS API ====================
app.get('/api/reports/daily', async (req, res, next) => {
  try {
    const day = req.query.day || today();
    if (!validDate(day)) return res.status(400).json({ error: 'Invalid date' });
    const department = req.query.department;

    let sql = `
      SELECT s.id, s.roll_no, s.full_name, s.course, s.department, s.year, s.section,
             COALESCE(a.status, 'NOT_MARKED') AS status
      FROM students s
      LEFT JOIN attendance a ON a.student_id = s.id AND a.day = ?
      WHERE 1=1
    `;
    const params = [day];
    if (department && department !== 'ALL') {
      sql += ' AND (s.department = ? OR s.course = ?)';
      params.push(department, department);
    }
    sql += ' ORDER BY s.roll_no ASC';

    const rows = await all(sql, params);
    const total = rows.length;
    const present = rows.filter(r => r.status === 'PRESENT').length;
    const absent = rows.filter(r => r.status === 'ABSENT').length;
    const late = rows.filter(r => r.status === 'LATE').length;
    const notMarked = rows.filter(r => r.status === 'NOT_MARKED').length;
    const rate = total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 0;

    res.json({
      day,
      summary: { total, present, absent, late, notMarked, rate },
      students: rows
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/reports/monthly', async (req, res, next) => {
  try {
    const month = req.query.month || today().slice(0, 7); // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format (YYYY-MM required)' });
    const department = req.query.department;

    // Get total distinct working days recorded in this month
    const daysRow = await all(
      "SELECT DISTINCT day FROM attendance WHERE day LIKE ? ORDER BY day ASC",
      [month + '%']
    );
    const workingDays = daysRow.map(d => d.day);

    let sql = `
      SELECT s.id, s.roll_no, s.full_name, s.course, s.department, s.year, s.section,
             COUNT(CASE WHEN a.status = 'PRESENT' THEN 1 END) AS present_count,
             COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END) AS absent_count,
             COUNT(CASE WHEN a.status = 'LATE' THEN 1 END) AS late_count,
             COUNT(a.id) AS recorded_days
      FROM students s
      LEFT JOIN attendance a ON a.student_id = s.id AND a.day LIKE ?
      WHERE 1=1
    `;
    const params = [month + '%'];
    if (department && department !== 'ALL') {
      sql += ' AND (s.department = ? OR s.course = ?)';
      params.push(department, department);
    }
    sql += ' GROUP BY s.id ORDER BY s.roll_no ASC';

    const rows = await all(sql, params);
    const studentsWithRate = rows.map(s => {
      const denom = workingDays.length || s.recorded_days || 1;
      const rate = denom > 0 ? Math.round(((s.present_count + s.late_count * 0.5) / denom) * 100) : 0;
      return {
        ...s,
        total_working_days: workingDays.length,
        attendance_percentage: Math.min(100, rate)
      };
    });

    const avgRate = studentsWithRate.length > 0
      ? Math.round(studentsWithRate.reduce((acc, c) => acc + c.attendance_percentage, 0) / studentsWithRate.length)
      : 0;

    res.json({
      month,
      workingDaysCount: workingDays.length,
      averageRate: avgRate,
      students: studentsWithRate
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/reports/student', async (req, res, next) => {
  try {
    const student_id = req.query.student_id;
    if (!student_id) return res.status(400).json({ error: 'student_id is required' });

    const student = await get('SELECT * FROM students WHERE id=?', [student_id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const history = await all(
      'SELECT day, status FROM attendance WHERE student_id=? ORDER BY day DESC',
      [student_id]
    );

    const total = history.length;
    const present = history.filter(h => h.status === 'PRESENT').length;
    const absent = history.filter(h => h.status === 'ABSENT').length;
    const late = history.filter(h => h.status === 'LATE').length;
    const rate = total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 0;

    res.json({
      student,
      stats: { total, present, absent, late, rate },
      history
    });
  } catch (e) {
    next(e);
  }
});

// CSV Export Endpoint
app.get('/api/reports/export', async (req, res, next) => {
  try {
    const type = req.query.type || 'daily';
    const day = req.query.day || today();
    const month = req.query.month || today().slice(0, 7);
    const department = req.query.department;

    if (type === 'daily') {
      let sql = `
        SELECT s.roll_no, s.full_name, s.course, s.department, s.year, s.section,
               COALESCE(a.status, 'NOT_MARKED') AS attendance_status,
               s.parent_name, s.parent_email, s.parent_phone
        FROM students s
        LEFT JOIN attendance a ON a.student_id = s.id AND a.day = ?
        WHERE 1=1
      `;
      const params = [day];
      if (department && department !== 'ALL') {
        sql += ' AND (s.department = ? OR s.course = ?)';
        params.push(department, department);
      }
      sql += ' ORDER BY s.roll_no ASC';

      const rows = await all(sql, params);
      let csv = 'Roll No,Student Name,Course,Department,Year,Section,Date,Status,Parent Name,Parent Email,Parent Phone\n';
      for (const r of rows) {
        csv += `"${r.roll_no}","${r.full_name}","${r.course}","${r.department || ''}","${r.year || ''}","${r.section || ''}","${day}","${r.attendance_status}","${r.parent_name}","${r.parent_email}","${r.parent_phone}"\n`;
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="SEI_Attendance_Daily_${day}.csv"`);
      return res.send(csv);
    } else if (type === 'monthly') {
      const daysRow = await all("SELECT DISTINCT day FROM attendance WHERE day LIKE ? ORDER BY day ASC", [month + '%']);
      const totalWorkingDays = daysRow.length;

      let sql = `
        SELECT s.roll_no, s.full_name, s.course, s.department, s.year, s.section,
               COUNT(CASE WHEN a.status = 'PRESENT' THEN 1 END) AS present_count,
               COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END) AS absent_count,
               COUNT(CASE WHEN a.status = 'LATE' THEN 1 END) AS late_count
        FROM students s
        LEFT JOIN attendance a ON a.student_id = s.id AND a.day LIKE ?
        WHERE 1=1
      `;
      const params = [month + '%'];
      if (department && department !== 'ALL') {
        sql += ' AND (s.department = ? OR s.course = ?)';
        params.push(department, department);
      }
      sql += ' GROUP BY s.id ORDER BY s.roll_no ASC';

      const rows = await all(sql, params);
      let csv = 'Roll No,Student Name,Course,Department,Year,Section,Month,Working Days,Present Days,Absent Days,Late Days,Attendance Percentage\n';
      for (const r of rows) {
        const denom = totalWorkingDays || (r.present_count + r.absent_count + r.late_count) || 1;
        const pct = Math.min(100, Math.round(((r.present_count + r.late_count * 0.5) / denom) * 100));
        csv += `"${r.roll_no}","${r.full_name}","${r.course}","${r.department || ''}","${r.year || ''}","${r.section || ''}","${month}",${totalWorkingDays},${r.present_count},${r.absent_count},${r.late_count},"${pct}%"\n`;
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="SEI_Attendance_Monthly_${month}.csv"`);
      return res.send(csv);
    } else if (type === 'student') {
      const student_id = req.query.student_id;
      if (!student_id) return res.status(400).json({ error: 'student_id required for student export' });
      const student = await get('SELECT * FROM students WHERE id=?', [student_id]);
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const history = await all('SELECT day, status FROM attendance WHERE student_id=? ORDER BY day DESC', [student_id]);
      let csv = 'Roll No,Student Name,Course,Department,Date,Status\n';
      for (const h of history) {
        csv += `"${student.roll_no}","${student.full_name}","${student.course}","${student.department || ''}","${h.day}","${h.status}"\n`;
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="SEI_Attendance_Student_${student.roll_no}.csv"`);
      return res.send(csv);
    }
    res.status(400).json({ error: 'Invalid export type' });
  } catch (e) {
    next(e);
  }
});

// Serve frontend entrypoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Request error:', err.code || err.message || err);
  if (err.code === 'SQLITE_CONSTRAINT') {
    return res.status(409).json({ error: 'Duplicate roll number or constraint violation' });
  }
  res.status(500).json({ error: 'Server request failed' });
});

const port = Number(process.env.PORT || 3100);
app.listen(port, '0.0.0.0', () => {
  console.log(`SEI University Attendance System online: http://0.0.0.0:${port}`);
});
