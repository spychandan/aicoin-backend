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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    // Helper to generate prompt with safety fallback for vision
    async function generatePrompt(side, description, additionalContext = '') {
      let userContent = `Description: ${description}. Shape: ${shape}. ${additionalContext}`;

      if (imageFiles.length > 0) {
        try {
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
        } catch (visionError) {
          // If vision fails due to safety, fall back to text-only
          if (visionError.status === 400 && visionError.code === 'content_policy_violation') {
            console.warn(`Vision safety error for ${side}, falling back to text-only`);
            // Continue to text-only generation
          } else {
            throw visionError; // rethrow other errors
          }
        }
      }

      // Text-only fallback
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

    const [frontPrompt, backPrompt] = await Promise.all([
      generatePrompt('front', frontDesc),
      generatePrompt('back', backDesc),
    ]);

    // Generate images with safety handling for DALL·E
    let frontImageRes, backImageRes;
    try {
      [frontImageRes, backImageRes] = await Promise.all([
        openai.images.generate({
          model: 'dall-e-3',
          prompt: frontPrompt,
          n: 1,
          size: '1024x1024',
          quality: 'hd',
          style: 'vivid',
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
    } catch (imageError) {
      // Check if it's a safety policy violation
      if (imageError.status === 400 && imageError.code === 'content_policy_violation') {
        return res.status(400).json({
          success: false,
          error: 'Your description was flagged by our safety system. Please rephrase your design descriptions (avoid potentially sensitive words like violence, weapons, hate symbols, etc.) and try again.',
        });
      }
      // If it's another error, rethrow
      throw imageError;
    }

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