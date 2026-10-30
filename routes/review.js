const express = require("express");
const router = express.Router();
const { requireReviewer } = require("../middleware/reviewerAuth");
const { getSubmission, updateSubmissionStatus, updateSubmission, resetSubmission, countCertificatesForYear } = require("../lib/db");
const { sendRejectionEmail, sendErrorAlert, submissionAlertData } = require("../lib/emailSender");
const { wp, geocoder } = require("../lib/clients");


// ============================================
// POST /api/review/approve
// ============================================
router.post("/:submissionId/approve", requireReviewer, async (req, res) => {
  const { submissionId } = req.params;
  let submission = null;
  let licenseNumber = null;
  try {
    const { reviewerNotes } = req.body;

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    submission = await getSubmission(submissionId);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (submission.status !== "submitted") {
      return res.status(400).json({ error: `Cannot review — current status is "${submission.status}"` });
    }

    const now = new Date();
    const year = now.getFullYear();
    const certCount = await countCertificatesForYear(year);
    const seqPadded = String(certCount + 1).padStart(4, "0");
    licenseNumber = `GMG-TXR-${year}-${seqPadded}`;
    const certificationDate = now.toISOString().split("T")[0];

    // 2. Update local DB (status + license + cert date)
    await updateSubmissionStatus(submissionId, "approved", reviewerNotes, {
      license_number: licenseNumber,
      certification_date: certificationDate,
    });

    // 3. Add applicant to WordPress certified applicator directory
    try {
      const gmapLocation = [
        submission.address,
        submission.suburb,
        submission.city,
        submission.region,
        submission.state,
        submission.post_code,
        submission.country,
      ].filter(Boolean).join(", ");

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
        licenseNumber,
        phone: submission.phone_number,
        email: submission.email,
        certDate: certificationDate,
        company: submission.company,
        streetAddress: submission.address,
        suburb: submission.suburb,
        city: submission.city,
        state: submission.state,
        postCode: submission.post_code,
        country: submission.country,
        displayAddress:submission.address ,
        gmapLocation,
        ...(geo ? { lat: geo.lat, lng: geo.lng } : {}),
      });
      console.log(`[WP] Added applicant ${licenseNumber} to certified applicator directory`);
    } catch (wpError) {
      console.error("[WP] Failed to add applicant:", wpError.message);
      try {
        await sendErrorAlert(
          "Add to WordPress Directory",
          `Application was approved in the database (license ${licenseNumber}) but was NOT added to the WordPress directory: ${wpError.message}`,
          submissionAlertData(submission, { status: "approved", licenseNumber })
        );
      } catch (_) {}
      // Don't fail the whole request — log and continue
    }

    // 4. Trigger Arlo certificate generation [SKIPPED FOR NOW]
    // TODO: Arlo's REST API supports generating registration certificates/reports.
    // We'd call something like arloClient.generateCertificate({ registrationId, licenseNumber, certDate })
    // and either store the returned PDF URL or push it back to the applicant. Leaving as placeholder.

    return res.json({
      message: "Application approved",
      submissionId,
      licenseNumber,
      certificationDate,
      status: "approved",
      ok: true,
    });

  } catch (error) {
    console.error("Approve error:", error);
    await sendErrorAlert(
      "Approve Application",
      `Approval failed: ${error.message}`,
      submissionAlertData(submission, { submissionId, licenseNumber })
    );
    return res.status(500).json({ error: "Failed to process approval", ok: false });
  }
});

// ============================================
// POST /api/review/reject
// ============================================
router.post("/:submissionId/reject", requireReviewer, async (req, res) => {
  const { submissionId } = req.params;
  let submission = null;
  try {
    const { reviewerNotes } = req.body;

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    submission = await getSubmission(submissionId);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (submission.status !== "submitted") {
      return res.status(400).json({ error: `Cannot review — current status is "${submission.status}"` });
    }

    // 1. Update status to rejected (keeps reviewer_notes for record)
    await updateSubmissionStatus(submissionId, "rejected", reviewerNotes);

    // 2. Reset the submission — clears files, generates new unique_code
    const newUniqueCode = await resetSubmission(submissionId);

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
      await sendErrorAlert(
        "Send Rejection Email",
        `Application was rejected but the applicant was NOT emailed their resubmission link (${newApplyLink}): ${emailError.message}`,
        submissionAlertData(submission, { status: "rejected" })
      );
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
    await sendErrorAlert(
      'Reject Application',
      `Rejection failed: ${error.message}`,
      submissionAlertData(submission, { submissionId })
    );
    return res.status(500).json({ error: "Failed to process rejection" });
  }
});

module.exports = router;