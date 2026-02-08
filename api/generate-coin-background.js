const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function setCors(res) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

export default async function handler(req, res) {
  setCors(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { description, shape, finish, engraving } = req.body ?? {};

    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }

    const prompt = `
Highly realistic custom commemorative coin.
Shape: ${shape || "custom"}
Material finish: ${finish || "gold"}
Engraving: ${engraving || "none"}
Design: ${description}
Studio lighting, premium metal texture, dark background
`;

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt,
          size: "1024x1024",
        }),
      }
    );

    const data = await response.json();

    console.log("OPENAI RAW RESPONSE:", JSON.stringify(data));

    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI request failed");
    }

    const imageBase64 = data?.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new Error("OpenAI returned no image data");
    }

    return res.status(200).json({
      success: true,
      imageBase64,
    });
  } catch (err) {
    console.error("OPENAI FAILURE:", err);
    return res.status(500).json({
      error: "Image generation failed",
      details: err.message,
    });
  }
}
