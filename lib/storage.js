const path = require("path");
const fs = require("fs");

const STORAGE_MODE = process.env.STORAGE_MODE || "local";
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

async function uploadFile(fileBuffer, fileName, applicantFolder) {
  if (STORAGE_MODE === "local") {
    return saveLocally(fileBuffer, fileName, applicantFolder);
  }
  return saveToSharePoint(fileBuffer, fileName, applicantFolder);
}

// ---- LOCAL (dev) ----

function saveLocally(fileBuffer, fileName, applicantFolder) {
  const folderPath = path.join(UPLOAD_DIR, applicantFolder);
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

  const safeName = `${Date.now()}-${fileName}`;
  const filePath = path.join(folderPath, safeName);
  fs.writeFileSync(filePath, fileBuffer);

  const baseUrl = process.env.APP_URL || "http://localhost:4200";
  const fileUrl = `${baseUrl}/uploads/${applicantFolder}/${safeName}`;

  console.log(`[LOCAL] Saved: ${filePath}`);
  return { url: fileUrl, id: safeName, name: safeName, size: fileBuffer.length };
}

// ---- SHAREPOINT (prod) — placeholder ----

async function saveToSharePoint(fileBuffer, fileName, applicantFolder) {
  // TODO: Uncomment when SharePoint is ready
  //
  // const { Client } = require("@microsoft/microsoft-graph-client");
  // require("isomorphic-fetch");
  //
  // const accessToken = await getAccessToken();
  // const client = Client.init({ authProvider: (done) => done(null, accessToken) });
  // const siteId = process.env.SHAREPOINT_SITE_ID;
  // const driveId = process.env.SHAREPOINT_DRIVE_ID;
  // const filePath = `ApplicationFiles/${applicantFolder}/${fileName}`;
  //
  // if (fileBuffer.length < 4 * 1024 * 1024) {
  //   const result = await client.api(`/sites/${siteId}/drives/${driveId}/root:/${filePath}:/content`).put(fileBuffer);
  //   return { url: result.webUrl, id: result.id, name: result.name, size: result.size };
  // }
  // return await uploadLargeFile(client, siteId, driveId, filePath, fileBuffer);

  throw new Error("SharePoint not configured. Set STORAGE_MODE=local for development.");
}

module.exports = { uploadFile };
