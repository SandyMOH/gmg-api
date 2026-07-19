const express = require("express");
const router = express.Router();
const multer = require("multer");
const { uploadFile } = require("../lib/storage");
const { getSubmission, updateSubmissionFiles } = require("../lib/db");
const { sendErrorAlert } = require("../lib/emailSender");

// Size limits per file type
const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,  // 10MB
  video: 100 * 1024 * 1024, // 100MB
};

// Multer config — store in memory, upload to storage from there
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 105 * 1024 * 1024 },
});

// POST /api/upload — upload image or video
router.post("/", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const { submissionId, fileType } = req.body;

    if (!file || !submissionId || !fileType) {
      return res.status(400).json({ error: "file, submissionId, and fileType are required", ok: false });
    }

    const submission = await getSubmission(submissionId);
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

    // Validate file size
    const maxSize = FILE_SIZE_LIMITS[fileType];
    if (maxSize && file.size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      return res.status(400).json({
        error: `${fileType} file too large. Maximum size is ${maxMB}MB.`,
        ok: false,
      });
    }

    // Upload to storage (local or SharePoint)
    const folderName = submission.arlo_registration_id || submission.applicant_id;
    const result = await uploadFile(file.buffer, file.originalname, folderName);

    // Update database
    if (fileType === "image") {
      await updateSubmissionFiles(submissionId, {
        imageUrl: result.url, imageFilename: file.originalname,
        videoUrl: null, videoFilename: null,
      });
    } else {
      await updateSubmissionFiles(submissionId, {
        imageUrl: null, imageFilename: null,
        videoUrl: result.url, videoFilename: file.originalname,
      });
    }

    return res.json({ message: `${fileType} uploaded successfully`, url: result.url, filename: file.originalname, ok: true });
  } catch (error) {
    console.error("Upload error:", error);
    await sendErrorAlert('File Upload', error.message, { submissionId: req.body.submissionId });
    return res.status(500).json({ error: "Failed to upload file", ok: false });
  }
});

module.exports = router;    