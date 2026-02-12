const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/generate-coin-background', async (req, res) => {
  try {
    const { description } = req.body;
    const imageFile = req.file; // using multer or similar

    // ----- STEP 1: Enrich the prompt with GPT-4V -----
    let enrichedPrompt = description;

    if (imageFile) {
      // Convert the uploaded image to base64
      const base64Image = imageFile.buffer.toString('base64');
      const dataUrl = `data:${imageFile.mimetype};base64,${base64Image}`;

      const visionResponse = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "system",
            content: "You are an expert coin designer. Analyze the provided reference image and the user's description. Create a single, extremely detailed DALL·E 3 prompt that will generate a realistic, metallic coin featuring the exact design from the reference image, adapted to a coin shape. Include specifics: metal texture, centered composition, edge details, lighting, and the coin's denomination or text if any. Do NOT include any extra commentary – output ONLY the prompt."
          },
          {
            role: "user",
            content: [
              { type: "text", text: `User's description: ${description}` },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
            ]
          }
        ],
        max_tokens: 500
      });

      enrichedPrompt = visionResponse.choices[0].message.content;
    }

    // ----- STEP 2: Generate the coin with DALL·E 3 -----
    const imageResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: enrichedPrompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
      style: "vivid",
      response_format: "b64_json"
    });

    const base64 = imageResponse.data[0].b64_json;

    res.json({
      success: true,
      imageBase64: base64
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});