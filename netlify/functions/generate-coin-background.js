import OpenAI from "openai";

export async function handler(event) {
  // ✅ CORS headers (used everywhere)
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  // ✅ Handle preflight request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: ""
    };
  }

  // ❌ Block anything except POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { description, engraving, finish, shape } = body;

    if (!description) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Description is required" })
      };
    }

    const prompt = `
Create a highly realistic custom coin concept.
Shape: ${shape || "custom shape"}
Material finish: ${finish || "gold"}
Engraving text: "${engraving || "none"}"
Design description: ${description}
Style: premium, commemorative, metal coin
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        imageUrl: result.data[0].url
      })
    };

  } catch (err) {
    console.error("OPENAI ERROR:", err);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Image generation failed",
        message: err.message
      })
    };
  }
}
