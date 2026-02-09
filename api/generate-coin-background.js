import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  // 🔥 CORS — MUST BE FIRST, ALWAYS
  res.setHeader("Access-Control-Allow-Origin", "https://allegiancecoin.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 🔥 Preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable({ multiples: false });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve({ fields, files });
      });
    });

    const description = fields.description;

    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }

    let referenceImageBase64 = null;

    if (files.reference) {
      const buffer = fs.readFileSync(files.reference.filepath);
      referenceImageBase64 = buffer.toString("base64");
    }

    const promptText = `
Highly realistic custom commemorative coin.
Design description: ${description}
Studio lighting, premium metal texture, dark background.
`;

    // ⚠️ OpenAI Images API currently uses prompt + optional reference
    const openaiPayload = {
      model: "gpt-image-1",
      prompt: promptText,
      size: "1024x1024"
    };

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(openaiPayload)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OPENAI ERROR:", data);
      throw new Error(data.error?.message || "OpenAI request failed");
    }

    const imageBase64 = data?.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new Error("OpenAI returned no image data");
    }

    return res.status(200).json({
      success: true,
      imageBase64
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({
      error: "Image generation failed",
      details: err.message
    });
  }
}
