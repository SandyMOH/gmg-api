const express = require("express");
const router = express.Router();
const { requireReviewer } = require("../middleware/reviewerAuth");
const { getSubmission, updateSubmissionStatus, resetSubmission } = require("../lib/db");

// POST /api/review — approve or reject (protected)
router.post("/", requireReviewer, async (req, res) => {
  try {
    const { submissionId, action, reviewerNotes } = req.body;

    if (!submissionId || !action) {
      return res.status(400).json({ error: "submissionId and action are required" });
    }
    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
    }

    const submission = getSubmission(submissionId);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (submission.status !== "submitted") {
      return res.status(400).json({ error: `Cannot review — current status is "${submission.status}"` });
    }

    // ============================================
    // APPROVE
    // ============================================
    if (action === "approved") {
      // 1. Update local DB
      updateSubmissionStatus(submissionId, "approved", reviewerNotes);

      // 2. Update WordPress certified applicator directory
      try {
        const wpClient = require("../lib/wpClient");
        if (wpClient.updateCertifiedApplicator) {
          await wpClient.updateCertifiedApplicator({
            arloRegistrationId: submission.arlo_registration_id,
            name: submission.name,
            email: submission.email,
            company: submission.company,
            region: submission.region,
            certificationDate: submission.certification_date,
            consentDirectoryListing: !!submission.consent_directory_listing,
            status: "certified",
          });
          console.log("[WP] Updated certified applicator directory");
        }
      } catch (wpError) {
        console.error("[WP] Failed to update:", wpError.message);
        // Don't fail the whole request — log and continue
      }

      // 3. Trigger Arlo report generation [PLACEHOLDER]
      try {
        const arloClient = require("../lib/arloClient");
        if (arloClient.generateCertificateReport) {
          await arloClient.generateCertificateReport({
            arloRegistrationId: submission.arlo_registration_id,
            name: submission.name,
            email: submission.email,
            status: "certified",
          });
          console.log("[ARLO] Triggered report generation");
        }
      } catch (arloError) {
        console.error("[ARLO] Failed to trigger report:", arloError.message);
      }

      return res.json({
        message: "Application approved",
        submissionId,
        status: "approved",
      });
    }

    // ============================================
    // REJECT
    // ============================================
    if (action === "rejected") {
      // 1. Update status to rejected (keeps reviewer_notes for record)
      updateSubmissionStatus(submissionId, "rejected", reviewerNotes);

      // 2. Reset the submission — clears files, generates new unique_code
      const newUniqueCode = resetSubmission(submissionId);

      // 3. Build new apply link
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const newApplyLink = `${frontendUrl}/apply/${newUniqueCode}`;

      // 4. Send rejection email to applicant with new submit link
      try {
        const emailSender = require("../lib/emailSender");
        if (emailSender.sendRejectionEmail) {
          await emailSender.sendRejectionEmail({
            to: submission.email,
            name: submission.name,
            reviewerNotes: reviewerNotes || "",
            newApplyLink,
          });
          console.log("[EMAIL] Sent rejection email to:", submission.email);
        }
      } catch (emailError) {
        console.error("[EMAIL] Failed to send rejection email:", emailError.message);
      }

      return res.json({
        message: "Application rejected — resubmission link sent",
        submissionId,
        status: "pending",
        newApplyLink,
      });
    }
  } catch (error) {
    console.error("Review error:", error);
    return res.status(500).json({ error: "Failed to process review" });
  }
});

module.exports = router;
