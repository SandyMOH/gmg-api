const express = require("express");
const router = express.Router();
const {
  createApplicant, createSubmission, getSubmission,
  getAllSubmissions, getSubmissionByCode, submitApplication,
  createReviewerToken,
} = require("../lib/db");
const { requireReviewer } = require("../middleware/reviewerAuth");
const { notifyReviewer, sendErrorAlert } = require("../lib/emailSender");

// GET /api/applicants/code/:code — lookup submission by unique code (for applicant form)
router.get("/code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    if (!code || code.length < 20) {
      return res.status(400).json({ error: "Invalid application link", ok: false });
    }

    const submission = await getSubmissionByCode(code);
    if (!submission) {
      return res.status(404).json({ error: "Application not found. This link may be invalid.", ok: false });
    }

    return res.json({ submission, ok: true });
  } catch (error) {
    console.error("Lookup error:", error);
    return res.status(500).json({ error: "Failed to load application", ok: false });
  }
});

// POST /api/applicants/:id/submit — applicant finalizes submission
router.post("/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const { consentDirectoryListing } = req.body;

    const submission = await getSubmission(id);
    if (!submission) return res.status(404).json({ error: "Submission not found", ok: false });
    if (submission.status !== "pending") {
      return res.status(400).json({ error: "This application has already been submitted", ok: false });
    }
    if (!submission.images?.length || !submission.video_url) {
      return res.status(400).json({ error: "Please upload at least one image and a video before submitting", ok: false  });
    }

    await submitApplication(id, consentDirectoryListing);

    // Generate reviewer token + send notification
    let reviewerToken = null;
    try {
      const { token } = await createReviewerToken(id);
      reviewerToken = token;

      await notifyReviewer(submission, token);
    } catch (emailError) {
      console.error("Failed to send notification:", emailError);
    }

    return res.json({ message: "Application submitted successfully", reviewerToken, ok: true });
  } catch (error) {
    console.error("Submit error:", error);
    await sendErrorAlert('Submit Application', error.message, { submissionId: id });
    return res.status(500).json({ error: "Failed to submit application", ok: false });
  }
});

// ============================================
// PROTECTED routes (reviewer only)
// ============================================

// GET /api/applicants — list all submissions
router.get("/", requireReviewer, async (req, res) => {
  try {
    const status = req.query.status || null;
    const search = req.query.search || null;
    const select = req.query.select || null;
    const submissions = await getAllSubmissions({ status, search, select });
    return res.json({ submissions });
  } catch (error) {
    console.error("Fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

// GET /api/applicants/:id — get single submission
router.get("/:id", requireReviewer, async (req, res) => {
  try {
    const submission = await getSubmission(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    return res.json({ submission });
  } catch (error) {
    console.error("Fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch submission" });
  }
});

module.exports = router;
