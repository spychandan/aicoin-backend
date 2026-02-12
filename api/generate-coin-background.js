import OpenAI from 'openai';
import multer from 'multer';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // set in Vercel environment variables
});

// Configure multer (memory storage, 5MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Promisify multer for serverless environment
const multerMiddleware = upload.single('image');

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Parse multipart form data
    await runMiddleware(req, res, multerMiddleware);

    const description = req.body.description?.trim();
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const imageFile = req.file; // undefined if no image uploaded

    // ----- STEP 1: Generate the perfect DALL·E 3 prompt -----
    let finalPrompt;

    if (imageFile) {
      // --- Case A: Reference image provided → Use GPT‑4V ---
      const base64Image = imageFile.buffer.toString('base64');
      const dataUrl = `data:${imageFile.mimetype};base64,${base64Image}`;

      const visionResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert coin designer. 
            - Analyze the reference image and the user's description.
            - Create ONE single, extremely detailed DALL·E 3 prompt that will generate a realistic, metallic coin.
            - The coin must be perfectly centered, facing forward, with crisp details.
            - Include: metal texture (gold/silver/bronze), edge details, denomination or text if any, and exact visual elements from the reference image.
            - Output ONLY the prompt – no explanations, no extra text.`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `User's description: ${description}` },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      finalPrompt = visionResponse.choices[0].message.content.trim();
    } else {
      // --- Case B: No image → Use GPT‑4 to enrich the description ---
      const textResponse = await openai.chat.completions.create({
        model: 'gpt-4o', // or 'gpt-3.5-turbo' for lower cost
        messages: [
          {
            role: 'system',
            content: `You are an expert coin designer. 
            - Expand the user's description into a detailed DALL·E 3 prompt.
            - The coin must be metallic, 3D, centered, with sharp details, realistic lighting.
            - Describe shape, symbols, inscriptions, edge style, and finish (gold/silver/copper).
            - Output ONLY the prompt – nothing else.`,
          },
          {
            role: 'user',
            content: description,
          },
        ],
        max_tokens: 400,
        temperature: 0.7,
      });

      finalPrompt = textResponse.choices[0].message.content.trim();
    }

    // ----- STEP 2: Generate the coin with DALL·E 3 -----
    const imageResponse = await openai.images.generate({
      model: 'dall-e-3',
      prompt: finalPrompt,
      n: 1,
      size: '1024x1024',
      quality: 'hd',      // essential for metallic/realistic look
      style: 'vivid',     // more dramatic lighting and contrast
      response_format: 'b64_json',
    });

    const base64 = imageResponse.data[0].b64_json;

    // ----- STEP 3: Return success response -----
    return res.status(200).json({
      success: true,
      imageBase64: base64,
    });
  } catch (error) {
    console.error('Coin generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate coin',
      details: error.stack, // helpful for debugging, remove in production
    });
  }
}