// server.js (paste whole file, replace the old one)
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import os from "os";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();
app.use(express.json({ limit: "50mb" }));

// Read env
const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME,
  AWS_REGION = "ap-south-1",
} = process.env;

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !S3_BUCKET_NAME) {
  console.warn(
    "Warning: Missing one of AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, or S3_BUCKET_NAME in env."
  );
}

// Create S3 client (v3)
const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID || "",
    secretAccessKey: AWS_SECRET_ACCESS_KEY || "",
  },
});

async function downloadToTemp(url) {
  // If local file path (file://), return local path
  if (typeof url === "string" && url.startsWith("file://")) {
    return url.replace("file://", "");
  }

  // Otherwise fetch remote URL
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download URL: ${url} status ${res.status}`);
  }
  const buffer = await res.buffer();
  const tmpPath = path.join(os.tmpdir(), `img_${Date.now()}${Math.random().toString(36).slice(2)}.tmp`);
  await fs.promises.writeFile(tmpPath, buffer);
  return tmpPath;
}

function guessContentTypeFromExt(ext) {
  ext = ext.toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

app.post("/api/inngest", async (req, res) => {
  try {
    const { sku = "unknown", product_id = Date.now().toString(), image_url } = req.body;

    if (!image_url) {
      return res.status(400).json({ ok: false, error: "Missing image_url in request body" });
    }

    // download to temp
    const tempPath = await downloadToTemp(image_url);

    // read file
    const fileBuffer = await fs.promises.readFile(tempPath);
    const ext = path.extname(tempPath) || ".png";
    const contentType = guessContentTypeFromExt(ext);

    // create key
    const key = `catalogs/${sku}/original_${Date.now()}${ext}`;

    // upload to S3
    const putCmd = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ACL: "public-read",
      ContentType: contentType,
    });

    await s3.send(putCmd);

    // Construct public URL (works for standard AWS S3)
    const publicUrl = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;

    // cleanup
    try {
      await fs.promises.unlink(tempPath);
    } catch (e) {
      // ignore cleanup error
    }

    return res.json({ ok: true, uploaded: publicUrl });
  } catch (err) {
    console.error("Error in /api/inngest:", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/", (req, res) => res.send("Shabib Inngest backend running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
