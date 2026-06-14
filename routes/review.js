const express = require("express");
const router = express.Router();
const { requireReviewer } = require("../middleware/reviewerAuth");
const { getSubmission, updateSubmissionStatus, resetSubmission } = require("../lib/db");
const { sendRejectionEmail } = require("../lib/emailSender");
const { wp, geocoder } = require("../lib/clients");


// ============================================
// POST /api/review/approve
// ============================================
router.post("/approve/:submissionId", requireReviewer, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { reviewerNotes } = req.body;

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    const submission = getSubmission(submissionId);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (submission.status !== "submitted") {
      return res.status(400).json({ error: `Cannot review — current status is "${submission.status}"` });
    }

    // 1. Update local DB
    updateSubmissionStatus(submissionId, "approved", reviewerNotes);

    // 2. Add applicant to WordPress certified applicator directory
    try {
      const displayAddress = [submission.suburb, submission.city, submission.state, submission.post_code]
        .filter(Boolean)
        .join(', ');

      const geo = await geocoder.geocode({
        street: submission.address,
        suburb: submission.suburb,
        city: submission.city,
        state: submission.state,
        postCode: submission.post_code,
      });

      await wp.createApplicator({
        title: submission.name,
        arloRegistrationId: submission.arlo_registration_id,
        licenseNumber: submission.license_number,
        phone: submission.phone_number,
        email: submission.email,
        certDate: submission.certification_date,
        company: submission.company,
        suburb: submission.suburb,
        city: submission.city,
        state: submission.state,
        postCode: submission.post_code,
        streetAddress: submission.address,
        displayAddress,
        ...(geo ? { lat: geo.lat, lng: geo.lng } : {}),
      });
      console.log("[WP] Added applicant to certified applicator directory");
    } catch (wpError) {
      console.error("[WP] Failed to add applicant:", wpError.message);
      await sendErrorAlert('Create Applicant/Submission (WP)', wpError.message, { submissionId });
      // Don't fail the whole request — log and continue
    }

    // 3. Trigger Arlo report generation [PLACEHOLDER]
    // try {
    //   const arloClient = require("../lib/arloClient");
    //   if (arloClient.generateCertificateReport) {
    //     await arloClient.generateCertificateReport({
    //       arloRegistrationId: submission.arlo_registration_id,
    //       name: submission.name,
    //       email: submission.email,
    //       status: "certified",
    //     });
    //     console.log("[ARLO] Triggered report generation");
    //   }
    // } catch (arloError) {
    //   console.error("[ARLO] Failed to trigger report:", arloError.message);
    // }

    return res.json({
      message: "Application approved",
      submissionId,
      status: "approved",
      ok: true,
    });

  } catch (error) {
    console.error("Approve error:", error);
    await sendErrorAlert('Approve Application', error.message, { submissionId });
    return res.status(500).json({ error: "Failed to process approval", ok: false });
  }
});

// ============================================
// POST /api/review/reject
// ============================================
router.post("/reject/:submissionId", requireReviewer, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { reviewerNotes } = req.body;

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    const submission = getSubmission(submissionId);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (submission.status !== "submitted") {
      return res.status(400).json({ error: `Cannot review — current status is "${submission.status}"` });
    }

    // 1. Update status to rejected (keeps reviewer_notes for record)
    updateSubmissionStatus(submissionId, "rejected", reviewerNotes);

    // 2. Reset the submission — clears files, generates new unique_code
    const newUniqueCode = resetSubmission(submissionId);

    // 3. Build new apply link
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const newApplyLink = `${frontendUrl}/apply/${newUniqueCode}`;

    // 4. Send rejection email to applicant with new submit link
    try {
      await sendRejectionEmail({
        name: submission.name,
        email: submission.email,
        reviewerNotes: reviewerNotes || "",
        newApplyLink,
      });
      console.log("[EMAIL] Sent rejection email to:", submission.email);
    } catch (emailError) {
      console.error("[EMAIL] Failed to send rejection email:", emailError.message);
    }

    return res.json({
      message: "Application rejected — resubmission link sent",
      submissionId,
      status: "pending", // Resetting to pending based on your original logic
      ok: true,
      newUniqueCode,
    });

  } catch (error) {
    console.error("Reject error:", error);
    await sendErrorAlert('Reject Application', error.message, { submissionId });
    return res.status(500).json({ error: "Failed to process rejection" });
  }
});

module.exports = router;