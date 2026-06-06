const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = path.join(__dirname, "..", "data", "app.db");

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applicants (
      id TEXT PRIMARY KEY,
      arlo_registration_id TEXT,
      license_number TEXT,
      certification_date TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      company TEXT,
      address TEXT,
      suburb TEXT,
      city TEXT,
      state TEXT,
      region TEXT,
      post_code TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      applicant_id TEXT NOT NULL,
      unique_code TEXT NOT NULL UNIQUE,
      image_url TEXT,
      video_url TEXT,
      image_filename TEXT,
      video_filename TEXT,
      consent_directory_listing INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'submitted', 'approved', 'rejected')),
      reviewer_notes TEXT,
      submitted_at TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (applicant_id) REFERENCES applicants(id)
    );

    CREATE TABLE IF NOT EXISTS reviewer_tokens (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      submission_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (submission_id) REFERENCES submissions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_unique_code ON submissions(unique_code);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_reviewer_tokens_token ON reviewer_tokens(token);
  `);
}

// ---- Token generators ----

function generateUniqueCode() {
  return crypto.randomBytes(32).toString("hex");
}

function generateReviewerToken() {
  return crypto.randomBytes(48).toString("hex");
}

// ---- Applicants ----

function createApplicant(data) {
  const id = uuidv4();
  getDb().prepare(
    `INSERT INTO applicants (id, arlo_registration_id, license_number, certification_date, name, email, phone_number, company, address, suburb, city, state, region, post_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, data.arloRegistrationId || null, data.licenseNumber || null,
    data.certificationDate || null, data.name, data.email,
    data.phoneNumber || null, data.company || null, data.address || null,
    data.suburb || null, data.city || null, data.state || null,
    data.region || null, data.postCode || null
  );
  return id;
}

function getApplicant(id) {
  return getDb().prepare("SELECT * FROM applicants WHERE id = ?").get(id);
}

// ---- Submissions ----

function createSubmission(applicantId) {
  const id = uuidv4();
  const uniqueCode = generateUniqueCode();
  getDb().prepare(
    "INSERT INTO submissions (id, applicant_id, unique_code) VALUES (?, ?, ?)"
  ).run(id, applicantId, uniqueCode);
  return { id, uniqueCode };
}

function getSubmissionByCode(code) {
  return getDb().prepare(
    `SELECT s.*, a.arlo_registration_id, a.license_number, a.certification_date,
            a.name, a.email, a.phone_number, a.company,
            a.address, a.suburb, a.city, a.state, a.region, a.post_code
     FROM submissions s JOIN applicants a ON s.applicant_id = a.id
     WHERE s.unique_code = ?`
  ).get(code);
}

function getSubmission(id) {
  return getDb().prepare(
    `SELECT s.*, a.arlo_registration_id, a.license_number, a.certification_date,
            a.name, a.email, a.phone_number, a.company,
            a.address, a.suburb, a.city, a.state, a.region, a.post_code
     FROM submissions s JOIN applicants a ON s.applicant_id = a.id
     WHERE s.id = ?`
  ).get(id);
}

function getAllSubmissions(status) {
  const sql = status
    ? `SELECT s.*, a.name, a.email, a.company, a.arlo_registration_id
       FROM submissions s JOIN applicants a ON s.applicant_id = a.id
       WHERE s.status = ? ORDER BY s.created_at DESC`
    : `SELECT s.*, a.name, a.email, a.company, a.arlo_registration_id
       FROM submissions s JOIN applicants a ON s.applicant_id = a.id
       ORDER BY s.created_at DESC`;
  return status ? getDb().prepare(sql).all(status) : getDb().prepare(sql).all();
}

function updateSubmissionFiles(id, { imageUrl, videoUrl, imageFilename, videoFilename }) {
  getDb().prepare(
    `UPDATE submissions SET
       image_url = COALESCE(?, image_url), video_url = COALESCE(?, video_url),
       image_filename = COALESCE(?, image_filename), video_filename = COALESCE(?, video_filename)
     WHERE id = ?`
  ).run(imageUrl, videoUrl, imageFilename, videoFilename, id);
}

function submitApplication(id, consentDirectoryListing) {
  getDb().prepare(
    "UPDATE submissions SET status = 'submitted', consent_directory_listing = ?, submitted_at = datetime('now') WHERE id = ?"
  ).run(consentDirectoryListing ? 1 : 0, id);
}

function updateSubmissionStatus(id, status, reviewerNotes) {
  getDb().prepare(
    "UPDATE submissions SET status = ?, reviewer_notes = ?, reviewed_at = datetime('now') WHERE id = ?"
  ).run(status, reviewerNotes, id);
}

// Reset submission for resubmission (on reject)
function resetSubmission(id) {
  const newCode = generateUniqueCode();
  getDb().prepare(
    `UPDATE submissions SET
       status = 'pending', unique_code = ?,
       image_url = NULL, video_url = NULL,
       image_filename = NULL, video_filename = NULL,
       consent_directory_listing = 0,
       reviewer_notes = NULL, submitted_at = NULL, reviewed_at = NULL
     WHERE id = ?`
  ).run(newCode, id);
  return newCode;
}

// ---- Reviewer Tokens ----

function createReviewerToken(submissionId) {
  const id = uuidv4();
  const token = generateReviewerToken();
  const expiryDays = parseInt(process.env.REVIEWER_TOKEN_EXPIRY_DAYS || "7");
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(
    "INSERT INTO reviewer_tokens (id, token, submission_id, expires_at) VALUES (?, ?, ?, ?)"
  ).run(id, token, submissionId, expiresAt);
  return { token, expiresAt };
}

function validateReviewerToken(token) {
  const row = getDb().prepare("SELECT * FROM reviewer_tokens WHERE token = ?").get(token);
  if (!row) return { valid: false, reason: "invalid" };
  if (new Date() > new Date(row.expires_at)) return { valid: false, reason: "expired", submissionId: row.submission_id };
  return { valid: true, submissionId: row.submission_id, expiresAt: row.expires_at };
}

module.exports = {
  getDb, generateUniqueCode,
  createApplicant, getApplicant,
  createSubmission, getSubmissionByCode, getSubmission, getAllSubmissions,
  updateSubmissionFiles, submitApplication, updateSubmissionStatus, resetSubmission,
  createReviewerToken, validateReviewerToken,
};
