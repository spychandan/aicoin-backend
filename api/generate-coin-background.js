import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import sharp from "sharp";
import potrace from "potrace";
import { exec } from "child_process";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  try {
    const { description } = req.body;
    if (!description) {
      return res.status(400).json({ error: "Description required" });
    }

    // 1️⃣ STRONG PROMPT (USER DOES NOTHING)
    const prompt = `
Flat orthographic front-view commemorative coin.
Single object centered.
Clear outer silhouette.
No perspective, no angle, no shadows.
High contrast between coin and background.
Raised metallic details.
Plain dark background.
Any custom shape allowed.
Design description: ${description}
`;

    // 2️⃣ Generate 2D image
    const imageBase64 = await generateImage(prompt);
    const imagePath = "/tmp/coin.png";

    fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));

    // 3️⃣ Convert to black/white silhouette
    const bwPath = "/tmp/coin-bw.png";
    await sharp(imagePath)
      .grayscale()
      .threshold(180)
      .toFile(bwPath);

    // 4️⃣ Convert silhouette → SVG
    const svgPath = "/tmp/coin.svg";
    await new Promise((resolve, reject) => {
      potrace.trace(bwPath, { color: "black" }, (err, svg) => {
        if (err) reject(err);
        fs.writeFileSync(svgPath, svg);
        resolve();
      });
    });

    // 5️⃣ SVG → GLB (extrusion)
    const glbPath = `/tmp/coin-${Date.now()}.glb`;
    await extrudeSVGToGLB(svgPath, glbPath);

    return res.json({
      success: true,
      glbUrl: `https://aicoin-backend.vercel.app/api/download?file=${path.basename(glbPath)}`
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

// ---- Helpers ----

async function generateImage(prompt) {
  const response = await fetch(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024"
      })
    }
  );

  const data = await response.json();
  return data.data[0].b64_json;
}

function extrudeSVGToGLB(svgPath, glbPath) {
  return new Promise((resolve, reject) => {
    exec(
      `npx svg-extrude ${svgPath} ${glbPath} --depth 4 --bevel`,
      (err) => {
        if (err) reject(err);
        resolve();
      }
    );
  });
}
