import formidable from "formidable";
import fs from "fs";

export const runtime = "nodejs"; // 🔥 REQUIRED
export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  // 🔥 CORS MUST BE FIRST
  res.setHeader("Access-Control-Allow-Origin", "https://allegiancecoin.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 🔥 Preflight
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

    // Optional reference file (currently unused by OpenAI image gen)
    if (files.reference) {
      fs.readFileSync(files.reference.filepath);
    }

    const prompt = `
Highly realistic custom commemorative coin.
Design description: ${description}
Studio lighting, premium metal texture, dark background.
`;

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

    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI request failed");
    }

    const imageBase64 = data?.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new Error("No image returned from OpenAI");
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
