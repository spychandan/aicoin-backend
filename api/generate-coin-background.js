import OpenAI from 'openai';
import multer from 'multer';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
});

const multerMiddleware = upload.array('images', 5); // max 5 images

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*'); // In production, restrict to your Shopify domain
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

    const imageFiles = req.files || [];

    async function generatePrompt(side, description, additionalContext = '') {
      let userContent = `Description: ${description}. Shape: ${shape}. ${additionalContext}`;

      if (imageFiles.length > 0) {
        const imageContents = await Promise.all(
          imageFiles.slice(0, 3).map(async (file) => {
            const base64 = file.buffer.toString('base64');
            const dataUrl = `data:${file.mimetype};base64,${base64}`;
            return { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } };
          })
        );

        const visionResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are an expert coin designer. Create a DALL·E 3 prompt for the ${side} of a coin.
              - Analyze any reference images and the user's description.
              - The coin must be metallic, 3D, centered, with sharp details.
              - Include metal texture, edge details, denomination or text if any.
              - Output ONLY the prompt – no extra text.`,
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: userContent },
                ...imageContents,
              ],
            },
          ],
          max_tokens: 500,
          temperature: 0.7,
        });
        return visionResponse.choices[0].message.content.trim();
      } else {
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
            { role: 'user', content: userContent },
          ],
          max_tokens: 400,
          temperature: 0.7,
        });
        return textResponse.choices[0].message.content.trim();
      }
    }

    const [frontPrompt, backPrompt] = await Promise.all([
      generatePrompt('front', frontDesc),
      generatePrompt('back', backDesc),
    ]);

    // Generate images with URL output (to avoid base64 size limits)
    const [frontImageRes, backImageRes] = await Promise.all([
      openai.images.generate({
        model: 'dall-e-3',
        prompt: frontPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid',
        // No response_format => returns URL
      }),
      openai.images.generate({
        model: 'dall-e-3',
        prompt: backPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid',
      }),
    ]);

    return res.status(200).json({
      success: true,
      frontImageUrl: frontImageRes.data[0].url,
      backImageUrl: backImageRes.data[0].url,
      shape,
    });
  } catch (error) {
    console.error('Coin generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate coin',
    });
  }
}