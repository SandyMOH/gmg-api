const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const mime = require("mime-types");
const { Client } = require("@microsoft/microsoft-graph-client");
require("isomorphic-fetch");

const STORAGE_MODE = process.env.STORAGE_MODE || "local";
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

// Characters Graph API rejects in SharePoint file/folder paths
const UNSAFE_CHARS = /["*:<>?/\\|#%]/g;

function sanitizeFileName(fileName) {
  return fileName.replace(UNSAFE_CHARS, "-");
}

// Date.now() alone can collide when multiple files in the same request upload
// concurrently (e.g. several images with the same original filename) — add
// randomness so every file gets a distinct storage path.
function uniqueName(fileName) {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${fileName}`;
}

let r2Client;
function getR2Client() {
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
      },
    });
  }
  return r2Client;
}

async function uploadFile(fileBuffer, fileName, applicantFolder) {
  const safeFileName = sanitizeFileName(fileName);

  if (STORAGE_MODE === "local") {
    return saveLocally(fileBuffer, safeFileName, applicantFolder);
  }
  if (STORAGE_MODE === "r2") {
    return saveToR2(fileBuffer, safeFileName, applicantFolder);
  }
  if (STORAGE_MODE === "sharepoint") {
    return saveToSharePoint(fileBuffer, safeFileName, applicantFolder);
  }

  throw new Error(
    `Unknown STORAGE_MODE: "${STORAGE_MODE}". Expected "local", "r2", or "sharepoint".`
  );
}

// ---- LOCAL (dev) ----

function saveLocally(fileBuffer, fileName, applicantFolder) {
  const folderPath = path.join(UPLOAD_DIR, applicantFolder);
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

  const safeName = uniqueName(fileName);
  const filePath = path.join(folderPath, safeName);
  fs.writeFileSync(filePath, fileBuffer);

  const baseUrl = process.env.APP_URL || "http://localhost:4200";
  const fileUrl = `${baseUrl}/uploads/${applicantFolder}/${safeName}`;

  console.log(`[LOCAL] Saved: ${filePath}`);
  return { url: fileUrl, id: safeName, name: safeName, size: fileBuffer.length };
}

// ---- CLOUDFLARE R2 ----

async function saveToR2(fileBuffer, fileName, applicantFolder) {
  const safeName = uniqueName(fileName);
  const key = `${applicantFolder}/${safeName}`;
  const contentType = mime.lookup(fileName) || "application/octet-stream";

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      ContentDisposition: "inline",
    })
  );

  const fileUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

  console.log(`[R2] Uploaded: ${key} (${contentType})`);
  return { url: fileUrl, id: safeName, name: safeName, size: fileBuffer.length };
}

// ---- SHAREPOINT (Graph API) ----

// Simple in-memory token cache so we don't request a new token on every upload
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  // Reuse cached token if it's still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );

  const data = await response.json();

  if (!data.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000; // expires_in is in seconds
  return cachedToken;
}

// Retry wrapper for transient network/Graph errors (not for auth or 4xx client errors)
async function withRetry(fn, { retries = 2, delayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.statusCode || err.status;
      // Don't retry on auth failures or bad requests — retrying won't fix those
      if (status && status < 500 && status !== 429) throw err;
      if (attempt < retries) {
        console.warn(`[SharePoint] Attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`, err.message);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

async function saveToSharePoint(fileBuffer, fileName, applicantFolder) {
  const driveId = process.env.SHAREPOINT_DRIVE_ID;
  const safeName = uniqueName(fileName);
  const filePath = `Thermal-XR-Applicant-Uploads/${applicantFolder}/${safeName}`;

  return withRetry(async () => {
    const accessToken = await getAccessToken();
    const client = Client.init({ authProvider: (done) => done(null, accessToken) });

    if (fileBuffer.length < 4 * 1024 * 1024) {
      const result = await client
        .api(`/drives/${driveId}/root:/${filePath}:/content`)
        .put(fileBuffer);
      return { url: result.webUrl, id: result.id, name: result.name, size: result.size };
    }
    return uploadLargeFile(client, driveId, filePath, fileBuffer);
  });
}

async function uploadLargeFile(client, driveId, filePath, fileBuffer) {
  const chunkSize = 5 * 1024 * 1024; // 5MB chunks (Graph recommends multiples of 320 KiB)
  const fileSize = fileBuffer.length;

  // Step 1: create an upload session
  const uploadSession = await client
    .api(`/drives/${driveId}/root:/${filePath}:/createUploadSession`)
    .post({
      item: {
        "@microsoft.graph.conflictBehavior": "replace",
      },
    });

  const uploadUrl = uploadSession.uploadUrl;

  // Step 2: upload in chunks
  let start = 0;
  let lastResponseData = null;

  while (start < fileSize) {
    const end = Math.min(start + chunkSize, fileSize) - 1;
    const chunk = fileBuffer.slice(start, end + 1);

    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": chunk.length,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      },
      body: chunk,
    });

    const data = await response.json();

    if (!response.ok && response.status !== 202) {
      throw new Error(`Large file upload failed at byte ${start}: ${JSON.stringify(data)}`);
    }

    lastResponseData = data;
    start = end + 1;
  }

  // Final response (status 201/200) contains the completed file's metadata
  return {
    url: lastResponseData.webUrl,
    id: lastResponseData.id,
    name: lastResponseData.name,
    size: lastResponseData.size,
  };
}

module.exports = {
  uploadFile,
  saveToSharePoint,
  getAccessToken,
  uploadLargeFile,
};