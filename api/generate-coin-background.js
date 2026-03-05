import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const multerMiddleware = upload.array("images", 5);

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      resolve(result);
    });
  });
}

async function generateImage(prompt) {

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ["IMAGE"]
        }
      })
    }
  );

  const data = await response.json();

  console.log("Gemini response:", JSON.stringify(data, null, 2));

  if (!data.candidates || !data.candidates.length) {
    throw new Error("Gemini returned no candidates");
  }

  const parts = data.candidates[0].content.parts;

  const imagePart = parts.find(p => p.inlineData);

  if (!imagePart) {
    throw new Error("Gemini did not return an image");
  }

  return `data:image/png;base64,${imagePart.inlineData.data}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    await runMiddleware(req, res, multerMiddleware);

    const {
      type,
      shape,
      frontDescription,
      backDescription,
      patchDescription,
      velcro,
    } = req.body;

    if (!type || (type !== "coin" && type !== "patch")) {
      return res.status(400).json({ error: "Invalid type" });
    }

    if (type === "coin") {
      if (!frontDescription?.trim() || !backDescription?.trim()) {
        return res
          .status(400)
          .json({ error: "Both front and back descriptions required" });
      }

      const frontPrompt = `
High quality 3D ${shape} challenge coin design (front side).
Description: ${frontDescription}.
Centered composition, realistic engraved metal texture,
sharp details, studio lighting, premium collectible coin.
`;

      const backPrompt = `
High quality 3D ${shape} challenge coin design (back side).
Description: ${backDescription}.
Centered composition, realistic engraved metal texture,
sharp details, studio lighting, premium collectible coin.
`;

      const [frontImageUrl, backImageUrl] = await Promise.all([
        generateImage(frontPrompt),
        generateImage(backPrompt),
      ]);

      return res.status(200).json({
        success: true,
        type: "coin",
        shape,
        velcro: "no",
        frontImageUrl,
        backImageUrl,
      });
    }

    if (type === "patch") {
      if (!patchDescription?.trim()) {
        return res
          .status(400)
          .json({ error: "Patch description required" });
      }

      const extra =
        velcro === "yes" ? "Include velcro backing." : "";

      const patchPrompt = `
Detailed embroidered military unit patch.
Shape: ${shape}.
Description: ${patchDescription}.
${extra}
Realistic stitching texture, embroidered fabric, centered layout,
high quality patch design.
`;

      const patchImageUrl = await generateImage(patchPrompt);

      return res.status(200).json({
        success: true,
        type: "patch",
        shape,
        velcro: velcro || "no",
        patchImageUrl,
      });
    }
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message || "Generation failed",
    });
  }
}