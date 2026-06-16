const mysql = require("mysql2/promise");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "gmg_api",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      // Ensure dates come back as strings, not JS Date objects
      dateStrings: true,
    });
  }
  return pool;
}

async function initTables() {
  const p = getPool();

  await p.execute(`
    CREATE TABLE IF NOT EXISTS applicants (
      id VARCHAR(36) PRIMARY KEY,
      arlo_registration_id VARCHAR(255),
      license_number VARCHAR(255),
      certification_date VARCHAR(255),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone_number VARCHAR(100),
      company VARCHAR(255),
      address TEXT,
      suburb VARCHAR(255),
      city VARCHAR(255),
      state VARCHAR(255),
      post_code VARCHAR(20),
      country VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await p.execute(`
    CREATE TABLE IF NOT EXISTS submissions (
      id VARCHAR(36) PRIMARY KEY,
      applicant_id VARCHAR(36) NOT NULL,
      unique_code VARCHAR(255) NOT NULL UNIQUE,
      image_url TEXT,
      video_url TEXT,
      image_filename VARCHAR(255),
      video_filename VARCHAR(255),
      consent_directory_listing TINYINT DEFAULT 0,
      status ENUM('pending', 'submitted', 'approved', 'rejected') DEFAULT 'pending',
      reviewer_notes TEXT,
      submitted_at DATETIME,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (applicant_id) REFERENCES applicants(id),
      INDEX idx_submissions_unique_code (unique_code),
      INDEX idx_submissions_status (status)
    )
  `);

  await p.execute(`
    CREATE TABLE IF NOT EXISTS reviewer_tokens (
      id VARCHAR(36) PRIMARY KEY,
      token VARCHAR(255) NOT NULL UNIQUE,
      submission_id VARCHAR(36) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id),
      INDEX idx_reviewer_tokens_token (token)
    )
  `);

  // Migration: add country column if missing
  const [cols] = await p.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'applicants'`,
    [process.env.DB_NAME || "gmg_api"]
  );
  const colNames = cols.map((c) => c.COLUMN_NAME);
  if (!colNames.includes("country")) {
    await p.execute("ALTER TABLE applicants ADD COLUMN country VARCHAR(255)");
  }
}

// ---- Token generators ----

function generateUniqueCode() {
  return crypto.randomBytes(32).toString("hex");
}

function generateReviewerToken() {
  return crypto.randomBytes(48).toString("hex");
}

// ---- Applicants ----

async function createApplicant(data) {
  const id = uuidv4();
  await getPool().execute(
    `INSERT INTO applicants (id, arlo_registration_id, license_number, certification_date, name, email, phone_number, company, address, suburb, city, state, post_code, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, data.arloRegistrationId || null, data.licenseNumber || null,
      data.certificationDate || null, data.name, data.email,
      data.phoneNumber || null, data.company || null, data.address || null,
      data.suburb || null, data.city || null, data.state || null,
      data.postCode || null, data.country || null,
    ]
  );
  return id;
}

async function getApplicant(id) {
  const [rows] = await getPool().execute("SELECT * FROM applicants WHERE id = ?", [id]);
  return rows[0] || null;
}

// ---- Submissions ----

async function createSubmission(applicantId) {
  const id = uuidv4();
  const uniqueCode = generateUniqueCode();
  await getPool().execute(
    "INSERT INTO submissions (id, applicant_id, unique_code) VALUES (?, ?, ?)",
    [id, applicantId, uniqueCode]
  );
  return { id, uniqueCode };
}

async function getSubmissionByCode(code) {
  const [rows] = await getPool().execute(
    `SELECT s.*, a.arlo_registration_id, a.license_number, a.certification_date,
            a.name, a.email, a.phone_number, a.company,
            a.address, a.suburb, a.city, a.state, a.post_code, a.country
     FROM submissions s JOIN applicants a ON s.applicant_id = a.id
     WHERE s.unique_code = ?`,
    [code]
  );
  return rows[0] || null;
}

async function getSubmission(id) {
  const [rows] = await getPool().execute(
    `SELECT s.*, a.arlo_registration_id, a.license_number, a.certification_date,
            a.name, a.email, a.phone_number, a.company,
            a.address, a.suburb, a.city, a.state, a.post_code, a.country
     FROM submissions s JOIN applicants a ON s.applicant_id = a.id
     WHERE s.id = ?`,
    [id]
  );
  return rows[0] || null;
}

const ALLOWED_SELECT_COLUMNS = new Set([
  "s.id", "s.status", "s.created_at", "s.submitted_at", "s.reviewed_at",
  "s.unique_code", "s.reviewer_notes", "s.consent_directory_listing",
  "s.image_url", "s.video_url", "s.image_filename", "s.video_filename",
  "s.applicant_id", "a.name", "a.email", "a.company", "a.arlo_registration_id",
  "a.phone_number", "a.address", "a.suburb", "a.city", "a.state", "a.post_code", "a.country",
]);

async function getAllSubmissions(query) {
  const { status, search, select } = query;

  let selectedCols = "s.applicant_id, s.id, a.name, a.email, a.company, a.arlo_registration_id";
  if (select) {
    const requested = select.split(",").map((c) => c.trim());
    const valid = requested.filter((c) => ALLOWED_SELECT_COLUMNS.has(c));
    if (valid.length > 0) selectedCols = valid.join(", ");
  }

  let sql = `SELECT ${selectedCols}
             FROM submissions s JOIN applicants a ON s.applicant_id = a.id`;
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push("s.status = ?");
    params.push(status);
  }
  if (search) {
    conditions.push("(a.name LIKE ? OR a.email LIKE ? OR a.company LIKE ?)");
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY s.created_at DESC";

  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function updateSubmissionFiles(id, { imageUrl, videoUrl, imageFilename, videoFilename }) {
  await getPool().execute(
    `UPDATE submissions SET
       image_url = COALESCE(?, image_url), video_url = COALESCE(?, video_url),
       image_filename = COALESCE(?, image_filename), video_filename = COALESCE(?, video_filename)
     WHERE id = ?`,
    [imageUrl, videoUrl, imageFilename, videoFilename, id]
  );
}

async function submitApplication(id, consentDirectoryListing) {
  await getPool().execute(
    "UPDATE submissions SET status = 'submitted', consent_directory_listing = ?, submitted_at = NOW() WHERE id = ?",
    [consentDirectoryListing ? 1 : 0, id]
  );
}

async function countCertificatesForYear(year) {
  const [rows] = await getPool().execute(
    "SELECT COUNT(*) as count FROM applicants WHERE license_number LIKE ?",
    [`GMG-TXR-${year}-%`]
  );
  return rows[0] ? rows[0].count : 0;
}

async function updateSubmissionStatus(id, status, reviewerNotes, extra = {}) {
  await getPool().execute(
    "UPDATE submissions SET status = ?, reviewer_notes = ?, reviewed_at = NOW() WHERE id = ?",
    [status, reviewerNotes, id]
  );

  if (extra.license_number || extra.certification_date) {
    const [rows] = await getPool().execute(
      "SELECT applicant_id FROM submissions WHERE id = ?",
      [id]
    );
    if (rows[0]) {
      await getPool().execute(
        "UPDATE applicants SET license_number = COALESCE(?, license_number), certification_date = COALESCE(?, certification_date) WHERE id = ?",
        [extra.license_number || null, extra.certification_date || null, rows[0].applicant_id]
      );
    }
  }
}

const ALLOWED_APPLICANT_FIELDS = new Set([
  "name", "email", "phone_number", "company",
  "address", "suburb", "city", "state", "post_code", "country", "arlo_registration_id",
]);

async function updateSubmission(id, data) {
  const [rows] = await getPool().execute(
    "SELECT applicant_id FROM submissions WHERE id = ?",
    [id]
  );
  if (!rows[0]) return false;

  const applicantUpdates = {};
  const submissionUpdates = {};

  for (const [key, value] of Object.entries(data)) {
    if (ALLOWED_APPLICANT_FIELDS.has(key)) applicantUpdates[key] = value;
    else if (key === "reviewer_notes") submissionUpdates.reviewer_notes = value;
  }

  if (Object.keys(applicantUpdates).length > 0) {
    const setClauses = Object.keys(applicantUpdates).map((k) => `${k} = ?`).join(", ");
    await getPool().execute(
      `UPDATE applicants SET ${setClauses} WHERE id = ?`,
      [...Object.values(applicantUpdates), rows[0].applicant_id]
    );
  }

  if (Object.keys(submissionUpdates).length > 0) {
    const setClauses = Object.keys(submissionUpdates).map((k) => `${k} = ?`).join(", ");
    await getPool().execute(
      `UPDATE submissions SET ${setClauses} WHERE id = ?`,
      [...Object.values(submissionUpdates), id]
    );
  }

  return true;
}

async function resetSubmission(id) {
  const newCode = generateUniqueCode();
  await getPool().execute(
    `UPDATE submissions SET
       status = 'pending', unique_code = ?,
       image_url = NULL, video_url = NULL,
       image_filename = NULL, video_filename = NULL,
       consent_directory_listing = 0,
       reviewer_notes = NULL, submitted_at = NULL, reviewed_at = NULL
     WHERE id = ?`,
    [newCode, id]
  );
  return newCode;
}

// ---- Reviewer Tokens ----

async function createReviewerToken(submissionId) {
  const id = uuidv4();
  const token = generateReviewerToken();
  const expiryDays = parseInt(process.env.REVIEWER_TOKEN_EXPIRY_DAYS || "7");
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  await getPool().execute(
    "INSERT INTO reviewer_tokens (id, token, submission_id, expires_at) VALUES (?, ?, ?, ?)",
    [id, token, submissionId, expiresAt]
  );
  return { token, expiresAt };
}

async function validateReviewerToken(token) {
  const [rows] = await getPool().execute(
    "SELECT * FROM reviewer_tokens WHERE token = ?",
    [token]
  );
  const row = rows[0];
  if (!row) return { valid: false, reason: "invalid" };
  if (new Date() > new Date(row.expires_at))
    return { valid: false, reason: "expired", submissionId: row.submission_id };
  return { valid: true, submissionId: row.submission_id, expiresAt: row.expires_at };
}

// ---- Cleanup ----

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  initTables,
  generateUniqueCode,
  createApplicant,
  getApplicant,
  createSubmission,
  getSubmissionByCode,
  getSubmission,
  getAllSubmissions,
  updateSubmissionFiles,
  submitApplication,
  updateSubmissionStatus,
  updateSubmission,
  resetSubmission,
  countCertificatesForYear,
  createReviewerToken,
  validateReviewerToken,
  closePool,
};