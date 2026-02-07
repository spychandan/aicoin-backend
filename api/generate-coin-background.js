import fs from "fs";
import path from "path";
import sharp from "sharp";
import * as THREE from "three";
import { SVGLoader } from "three-stdlib";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const potrace = require("potrace");


/**
 * POST body:
 * {
 *   "imageBase64": "data:image/png;base64,..."
 * }
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 required" });
    }

    // --- temp paths ---
    const ts = Date.now();
    const pngPath = `/tmp/coin-${ts}.png`;
    const svgPath = `/tmp/coin-${ts}.svg`;
    const glbPath = `/tmp/coin-${ts}.glb`;

    /* --------------------------------------------------
       1️⃣ IMAGE → CLEAN SILHOUETTE (CRITICAL STEP)
       -------------------------------------------------- */
    const imageBuffer = Buffer.from(
      imageBase64.replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );

    await sharp(imageBuffer)
      .resize(1024, 1024, { fit: "contain", background: "#ffffff" })
      .grayscale()
      .threshold(180)
      .png()
      .toFile(pngPath);

    /* --------------------------------------------------
       2️⃣ PNG → SVG (VECTOR OUTLINE)
       -------------------------------------------------- */
    const svg = await new Promise((resolve, reject) => {
      potrace.trace(
        pngPath,
        {
          threshold: 180,
          turdSize: 100,
          optCurve: true,
          optTolerance: 0.2
        },
        (err, svg) => {
          if (err) reject(err);
          else resolve(svg);
        }
      );
    });

    fs.writeFileSync(svgPath, svg);

    /* --------------------------------------------------
       3️⃣ SVG → 3D EXTRUDED COIN (THREE.JS)
       -------------------------------------------------- */
    const svgData = fs.readFileSync(svgPath, "utf8");
    const loader = new SVGLoader();
    const svgParsed = loader.parse(svgData);

    const scene = new THREE.Scene();

    svgParsed.paths.forEach((pathItem) => {
      const shapes = SVGLoader.createShapes(pathItem);

      shapes.forEach((shape) => {
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: 4,
          bevelEnabled: true,
          bevelThickness: 0.4,
          bevelSize: 0.4,
          bevelSegments: 2
        });

        geometry.center();

        const material = new THREE.MeshStandardMaterial({
          color: 0xd4af37, // gold-like
          metalness: 0.95,
          roughness: 0.25
        });

        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
      });
    });

    // lighting (important for realism)
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    /* --------------------------------------------------
       4️⃣ EXPORT → GLB
       -------------------------------------------------- */
    const exporter = new GLTFExporter();

    await new Promise((resolve, reject) => {
      exporter.parse(
        scene,
        (gltf) => {
          fs.writeFileSync(glbPath, Buffer.from(gltf));
          resolve();
        },
        (err) => reject(err),
        { binary: true }
      );
    });

    /* --------------------------------------------------
       5️⃣ RETURN GLB AS BASE64
       -------------------------------------------------- */
    const glbBase64 = fs.readFileSync(glbPath).toString("base64");

    return res.status(200).json({
      success: true,
      glbBase64
    });

  } catch (err) {
    console.error("Coin generation error:", err);
    return res.status(500).json({
      error: "Coin generation failed",
      details: err.message
    });
  }
}
