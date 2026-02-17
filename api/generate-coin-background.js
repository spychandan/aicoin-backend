import OpenAI from 'openai';
import multer from 'multer';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configure multer for multiple files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
});

// Middleware to parse fields: frontImage, backImage, sideImage (optional)
const multerMiddleware = upload.fields([
  { name: 'frontImage', maxCount: 1 },
  { name: 'backImage', maxCount: 1 },
  { name: 'sideImage', maxCount: 1 },
]);

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await runMiddleware(req, res, multerMiddleware);

    const frontDesc = req.body.frontDescription?.trim();
    const backDesc = req.body.backDescription?.trim();
    const shape = req.body.shape || 'round';

    if (!frontDesc || !backDesc) {
      return res.status(400).json({ error: 'Both front and back descriptions are required' });
    }

    // Get uploaded files
    const frontImageFile = req.files?.frontImage?.[0];
    const backImageFile = req.files?.backImage?.[0];
    const sideImageFile = req.files?.sideImage?.[0]; // optional, can be used for both sides or ignored

    // Helper to generate prompt for a single side
    async function generatePrompt(side, description, imageFile, additionalContext = '') {
      if (imageFile) {
        // Use GPT-4V with reference image
        const base64 = imageFile.buffer.toString('base64');
        const dataUrl = `data:${imageFile.mimetype};base64,${base64}`;

        const visionResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are an expert coin designer. Create a DALL·E 3 prompt for the ${side} of a coin.
              - Analyze the reference image and the user's description.
              - The coin must be metallic, 3D, centered, with sharp details.
              - Include metal texture, edge details, denomination or text if any.
              - Output ONLY the prompt – no extra text.`,
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: `Description: ${description}. Shape: ${shape}. ${additionalContext}` },
                { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
              ],
            },
          ],
          max_tokens: 500,
          temperature: 0.7,
        });
        return visionResponse.choices[0].message.content.trim();
      } else {
        // Text-only GPT-4 prompt
        const textResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are an expert coin designer. Create a DALL·E 3 prompt for the ${side} of a coin.
              - Expand the user's description into a detailed prompt.
              - The coin must be metallic, 3D, centered, with sharp details.
              - Describe shape, symbols, inscriptions, edge style, and finish.
              - Output ONLY the prompt.`,
            },
            {
              role: 'user',
              content: `Description: ${description}. Shape: ${shape}. ${additionalContext}`,
            },
          ],
          max_tokens: 400,
          temperature: 0.7,
        });
        return textResponse.choices[0].message.content.trim();
      }
    }

    // Generate prompts for front and back (possibly using side image as extra reference)
    const [frontPrompt, backPrompt] = await Promise.all([
      generatePrompt('front', frontDesc, frontImageFile, sideImageFile ? 'Use side reference for overall form.' : ''),
      generatePrompt('back', backDesc, backImageFile, sideImageFile ? 'Use side reference for overall form.' : ''),
    ]);

    // Generate both images concurrently
    const [frontImageRes, backImageRes] = await Promise.all([
      openai.images.generate({
        model: 'dall-e-3',
        prompt: frontPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid',
        response_format: 'b64_json',
      }),
      openai.images.generate({
        model: 'dall-e-3',
        prompt: backPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid',
        response_format: 'b64_json',
      }),
    ]);

    return res.status(200).json({
      success: true,
      frontImageBase64: frontImageRes.data[0].b64_json,
      backImageBase64: backImageRes.data[0].b64_json,
      shape, // pass back for frontend 3D
    });
  } catch (error) {
    console.error('Coin generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate coin',
    });
  }
}