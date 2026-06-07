const express = require("express");
const router = express.Router();
const multer = require("multer");
const { uploadFile } = require("../lib/storage");
const { getSubmission, updateSubmissionFiles } = require("../lib/db");

// Multer config — store in memory, upload to storage from there
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

// POST /api/upload — upload image or video
router.post("/", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const { submissionId, fileType } = req.body;

    if (!file || !submissionId || !fileType) {
      return res.status(400).json({ error: "file, submissionId, and fileType are required", ok: false });
    }

    const submission = getSubmission(submissionId);
    if (!submission) return res.status(404).json({ error: "Submission not found", ok: false });

    // Validate file type
    const allowedImage = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const allowedVideo = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
    const allowed = fileType === "image" ? allowedImage : allowedVideo;

    if (!allowed.includes(file.mimetype)) {
      return res.status(400).json({
        error: `Invalid ${fileType} format. Allowed: ${allowed.join(", ")}`,
        ok: false
      });
    }

    // Upload to storage (local or SharePoint)
    const folderName = submission.arlo_registration_id || submission.applicant_id;
    const result = await uploadFile(file.buffer, file.originalname, folderName);

    // Update database
    if (fileType === "image") {
      updateSubmissionFiles(submissionId, {
        imageUrl: result.url, imageFilename: file.originalname,
        videoUrl: null, videoFilename: null,
      });
    } else {
      updateSubmissionFiles(submissionId, {
        imageUrl: null, imageFilename: null,
        videoUrl: result.url, videoFilename: file.originalname,
      });
    }

    return res.json({ message: `${fileType} uploaded successfully`, url: result.url, filename: file.originalname, ok: true });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: "Failed to upload file", ok: false });
  }
});

module.exports = router;
