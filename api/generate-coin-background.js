import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import sharp from "sharp";
import * as THREE from "three";
import { GLTFExporter } from "three-stdlib";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { description } = req.body;
    if (!description) {
      return res.status(400).json({ error: "Description required" });
    }

    // 1️⃣ STRONG PROMPT (forced orthographic)
    const prompt = `
Flat orthographic front-view commemorative coin.
Single object centered.
Clear silhouette.
No perspective.
High contrast.
Plain dark background.
Metallic raised details.
Design: ${description}
`;

    // 2️⃣ Generate image
    const imageBase64 = await generateImage(prompt);
    const imgBuffer = Buffer.from(imageBase64, "base64");

    // 3️⃣ Convert to grayscale heightmap
    const { data, info } = await sharp(imgBuffer)
      .resize(256, 256)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 4️⃣ Create 3D mesh
    const geometry = new THREE.PlaneGeometry(10, 10, 255, 255);

    for (let i = 0; i < geometry.attributes.position.count; i++) {
      const height = data[i] / 255;
      geometry.attributes.position.setZ(i, height * 1.5);
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      metalness: 1,
      roughness: 0.3
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotateX(-Math.PI / 2);

    const scene = new THREE.Scene();
    scene.add(mesh);

    // 5️⃣ Export GLB
    const exporter = new GLTFExporter();
    const glbPath = `/tmp/coin-${Date.now()}.glb`;

    await new Promise((resolve, reject) => {
      exporter.parse(
        scene,
        (result) => {
          fs.writeFileSync(glbPath, Buffer.from(result));
          resolve();
        },
        reject,
        { binary: true }
      );
    });

    return res.json({
      success: true,
      glbUrl: `https://aicoin-backend.vercel.app/api/download?file=${path.basename(glbPath)}`
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function generateImage(prompt) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
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
  });

  const data = await res.json();
  return data.data[0].b64_json;
}
