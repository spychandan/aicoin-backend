const OpenAI = require("openai");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

module.exports = async function handler(req, res) {

  // ✅ CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).set(corsHeaders).end();
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .set(corsHeaders)
      .json({ error: "Method not allowed" });
  }

  try {
    const { description, shape, finish, engraving } = req.body || {};

    if (!description) {
      return res
        .status(400)
        .set(corsHeaders)
        .json({ error: "Description is required" });
    }

    const prompt = `
Highly realistic custom commemorative coin.
Shape: ${shape || "custom"}
Material finish: ${finish || "gold"}
Engraving text: ${engraving || "none"}
Design description: ${description}
Style: premium metal coin
Lighting: studio lighting highlighting metal texture
Background: dark neutral
View: centered, front-facing
`;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024"
    });

    return res.status(200).set(corsHeaders).json({
      success: true,
      imageUrl: result.data[0].url
    });

  } catch (err) {
    console.error("OPENAI ERROR:", err);
    return res.status(500).set(corsHeaders).json({
      error: "Image generation failed",
      message: err.message
    });
  }
};
