const express = require("express");
const router = express.Router();
const multer = require("multer");
const { uploadFile } = require("../lib/storage");
const { getSubmission, updateSubmissionFiles, addSubmissionImages } = require("../lib/db");
const { sendErrorAlert } = require("../lib/emailSender");

// Size limits per file type
const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,  // 10MB
  video: 100 * 1024 * 1024, // 100MB
};

const MAX_IMAGES_PER_UPLOAD = 10;

// Multer config — store in memory, upload to storage from there
// "file" stays a single upload (video); "files" accepts multiple (images)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 105 * 1024 * 1024 },
});
const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "files", maxCount: MAX_IMAGES_PER_UPLOAD },
]);

// Wrap multer so limit violations (e.g. too many images) return clean JSON instead of a raw 500
function handleUpload(req, res, next) {
  uploadFields(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
          ? `Too many files. Maximum ${MAX_IMAGES_PER_UPLOAD} images per upload.`
          : err.message;
      return res.status(400).json({ error: message, ok: false });
    }
    if (err) return next(err);
    next();
  });
}

const ALLOWED_MIME_TYPES = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  video: ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"],
};

function validateFile(file, fileType) {
  const allowed = ALLOWED_MIME_TYPES[fileType];
  if (!allowed.includes(file.mimetype)) {
    return `Invalid ${fileType} format for "${file.originalname}". Allowed: ${allowed.join(", ")}`;
  }
  const maxSize = FILE_SIZE_LIMITS[fileType];
  if (maxSize && file.size > maxSize) {
    const maxMB = Math.round(maxSize / (1024 * 1024));
    return `"${file.originalname}" is too large. Maximum size is ${maxMB}MB.`;
  }
  return null;
}

// POST /api/upload — upload image(s) (field "files") or a video (field "file")
router.post("/", handleUpload, async (req, res) => {
  try {
    const { submissionId, fileType } = req.body;
    const files = fileType === "image" ? req.files?.files : req.files?.file;

    if (!files || files.length === 0 || !submissionId || !fileType) {
      return res.status(400).json({ error: "file(s), submissionId, and fileType are required", ok: false });
    }

    const submission = await getSubmission(submissionId);
    if (!submission) return res.status(404).json({ error: "Submission not found", ok: false });

    // Validate every file before uploading any of them
    for (const file of files) {
      const validationError = validateFile(file, fileType);
      if (validationError) {
        return res.status(400).json({ error: validationError, ok: false });
      }
    }

    // Upload to storage (local or SharePoint)
    const folderName = submission.arlo_registration_id || submission.applicant_id;
    const results = await Promise.all(
      files.map((file) => uploadFile(file.buffer, file.originalname, folderName))
    );

    if (fileType === "image") {
      const images = await addSubmissionImages(
        submissionId,
        results.map((result, i) => ({ url: result.url, filename: files[i].originalname }))
      );
      return res.json({ message: "Images uploaded successfully", images, ok: true });
    }

    const [result] = results;
    await updateSubmissionFiles(submissionId, {
      imageUrl: null, imageFilename: null,
      videoUrl: result.url, videoFilename: files[0].originalname,
    });

    return res.json({ message: "video uploaded successfully", url: result.url, filename: files[0].originalname, ok: true });
  } catch (error) {
    console.error("Upload error:", error);
    await sendErrorAlert('File Upload', error.message, { submissionId: req.body.submissionId });
    return res.status(500).json({ error: "Failed to upload file", ok: false });
  }
});

module.exports = router;    