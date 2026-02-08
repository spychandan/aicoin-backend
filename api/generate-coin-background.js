import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { createCanvas, loadImage } from "canvas";
import potrace from "potrace";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

export default async function handler(req, res) {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing image" });
    }

    // ---------- STEP 1: Save PNG ----------
    const id = uuid();
    const pngPath = `/tmp/${id}.png`;
    const svgPath = `/tmp/${id}.svg`;
    const glbPath = `/tmp/${id}.glb`;

    const buffer = Buffer.from(imageBase64, "base64");
    fs.writeFileSync(pngPath, buffer);

    // ---------- STEP 2: PNG → SVG ----------
    await new Promise((resolve, reject) => {
      potrace.trace(pngPath, { threshold: 180 }, (err, svg) => {
        if (err) reject(err);
        fs.writeFileSync(svgPath, svg);
        resolve();
      });
    });

    // ---------- STEP 3: SVG → 3D ----------
    const svgData = fs.readFileSync(svgPath, "utf8");
    const loader = new SVGLoader();
    const svg = loader.parse(svgData);

    const shapes = [];
    svg.paths.forEach((p) => {
      shapes.push(...p.toShapes(true));
    });

    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth: 0.15,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.02,
      bevelSegments: 3
    });

    geometry.center();

    const material = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.9,
      roughness: 0.3
    });

    const mesh = new THREE.Mesh(geometry, material);

    const scene = new THREE.Scene();
    scene.add(mesh);

    // ---------- STEP 4: Export GLB ----------
    const exporter = new GLTFExporter();
    await new Promise((resolve) => {
      exporter.parse(
        scene,
        (gltf) => {
          fs.writeFileSync(glbPath, Buffer.from(gltf));
          resolve();
        },
        { binary: true }
      );
    });

    // ---------- STEP 5: Return GLB ----------
    const glbBase64 = fs.readFileSync(glbPath).toString("base64");

    res.json({
      success: true,
      glbBase64
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "3D generation failed" });
  }
}
