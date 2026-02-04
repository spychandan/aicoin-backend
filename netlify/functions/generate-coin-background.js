import OpenAI from "openai";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export async function handler(event) {

  // ✅ HANDLE PREFLIGHT FIRST — VERY IMPORTANT
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: ""
    };
  }

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
Highly realistic custom coin product photo.
Shape: ${shape || "custom"}
Material: ${finish || "gold"}
Engraving: ${engraving || "none"}
Design: ${description}
Style: premium commemorative coin
Lighting: studio lighting
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
    console.error("FUNCTION ERROR:", err);
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
