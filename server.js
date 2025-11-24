import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import os from "os";
import AWS from "aws-sdk";

const app = express();
app.use(express.json({ limit: "50mb" }));

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME,
  AWS_REGION = "ap-south-1",
} = process.env;

// ---- FIXED S3 INITIALIZATION ----
const s3 = new AWS.S3({
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION,
});

// ---- DOWNLOAD IMAGE TO TEMP ----
async function downloadToTemp(url) {
  if (url.startsWith("file://")) {
    return url.replace("file://", "");
  } else {
    const res = await fetch(url);
    const buffer = await res.buffer();
    const tmpPath = path.join(os.tmpdir(), `img_${Date.now()}.png`);
    await fs.promises.writeFile(tmpPath, buffer);
    return tmpPath;
  }
}

// ---- MAIN API ENDPOINT ----
app.post("/api/inngest", async (req, res) => {
  try {
    const { sku, product_id, image_url } = req.body;

    const tempFile = await downloadToTemp(image_url);
    const ext = path.extname(tempFile);
    const key = `catalogs/${sku}/original_${Date.now()}${ext}`;

    const fileBuffer = await fs.promises.readFile(tempFile);

    await s3
      .putObject({
        Bucket: S3_BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ACL: "public-read",
        ContentType: "image/png",
      })
      .promise();

    const url = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;

    return res.json({ ok: true, uploaded: url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.toString() });
  }
});

// ---- CHECK ROUTE ----
app.get("/", (req, res) => res.send("Shabib Inngest backend running"));

// ---- EXPRESS LISTENER FOR DEVELOPMENT (ignored by Vercel) ----
app.listen(3000, () => console.log("Server running locally"));
