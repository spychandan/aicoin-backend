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
  // CORS headers
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

    // Helper: generate prompt using images (vision)
    async function generatePromptWithImages(side, description) {
      const userContent = `Description: ${description}. Shape: ${shape}.`;

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
            - Analyze the reference images and the user's description.
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
    }

    // Helper: generate prompt using text only
    async function generatePromptTextOnly(side, description) {
      const userContent = `Description: ${description}. Shape: ${shape}.`;

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

    // Generate prompts (with fallback if vision fails)
    let frontPrompt, backPrompt;
    let imagesUsed = false;

    if (imageFiles.length > 0) {
      imagesUsed = true;
      try {
        [frontPrompt, backPrompt] = await Promise.all([
          generatePromptWithImages('front', frontDesc),
          generatePromptWithImages('back', backDesc),
        ]);
      } catch (visionError) {
        // If vision fails due to safety, fall back to text-only for both
        if (visionError.status === 400 && visionError.code === 'content_policy_violation') {
          console.warn('Vision safety error, falling back to text-only for both sides');
          imagesUsed = false; // mark that images weren't used
          [frontPrompt, backPrompt] = await Promise.all([
            generatePromptTextOnly('front', frontDesc),
            generatePromptTextOnly('back', backDesc),
          ]);
        } else {
          throw visionError; // rethrow other errors
        }
      }
    } else {
      // No images, just text
      [frontPrompt, backPrompt] = await Promise.all([
        generatePromptTextOnly('front', frontDesc),
        generatePromptTextOnly('back', backDesc),
      ]);
    }

    // Helper: generate image with retry on safety violation
    async function generateImageWithRetry(prompt, side, description, usedImages) {
      try {
        const res = await openai.images.generate({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'hd',
          style: 'vivid',
        });
        return res.data[0].url;
      } catch (error) {
        if (error.status === 400 && error.code === 'content_policy_violation') {
          console.warn(`DALL·E safety error for ${side}, retrying with text-only prompt`);
          // Generate a new prompt without any image influence
          const textOnlyPrompt = await generatePromptTextOnly(side, description);
          const res = await openai.images.generate({
            model: 'dall-e-3',
            prompt: textOnlyPrompt,
            n: 1,
            size: '1024x1024',
            quality: 'hd',
            style: 'vivid',
          });
          return res.data[0].url;
        } else {
          throw error;
        }
      }
    }

    // Generate images with per-side retry
    const [frontImageUrl, backImageUrl] = await Promise.all([
      generateImageWithRetry(frontPrompt, 'front', frontDesc, imagesUsed),
      generateImageWithRetry(backPrompt, 'back', backDesc, imagesUsed),
    ]);

    // Determine if any side fell back to text-only due to safety
    const finalImagesUsed = imagesUsed; // may be false if vision failed
    // (We could add more granular flags, but this is enough for now)

    return res.status(200).json({
      success: true,
      frontImageUrl,
      backImageUrl,
      shape,
      imagesUsed: finalImagesUsed,
      message: finalImagesUsed ? null : 'Your reference images could not be processed due to safety filters. The coin was generated based on your text descriptions only.',
    });
  } catch (error) {
    console.error('Coin generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate coin',
    });
  }
}