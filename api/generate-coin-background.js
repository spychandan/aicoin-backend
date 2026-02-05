const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).set(corsHeaders).end();
  }

  // Allow only POST
  if (req.method !== "POST") {
    return res.status(405).set(corsHeaders).json({
      error: "Method not allowed",
    });
  }

  try {
    const { description, shape, finish, engraving } = req.body ?? {};

    if (!description) {
      return res.status(400).set(corsHeaders).json({
        error: "Description is required",
      });
    }

    const prompt = `
Highly realistic custom commemorative coin.
Shape: ${shape || "custom"}
Material finish: ${finish || "gold"}
Engraving: ${engraving || "none"}
Design: ${description}
Studio lighting, premium metal texture, dark background
`;

    const response = await fetch("https://api.openai.com/v1/images/generations", {
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
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI request failed");
    }

    if (!data?.data?.[0]?.url) {
      throw new Error("No image returned from OpenAI");
    }

    return res.status(200).set(corsHeaders).json({
      success: true,
      imageUrl: data.data[0].url,
    });
  } catch (err) {
    console.error("OPENAI FAILURE:", err);
    return res.status(500).set(corsHeaders).json({
      error: "Image generation failed",
      details: err.message,
    });
  }
}
