import OpenAI from 'openai';
import multer from 'multer';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
});

const multerMiddleware = upload.array('images', 5);

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

    const { type, shape, frontDescription, backDescription, patchDescription, velcro } = req.body;
    const imageFiles = req.files || [];

    if (!type || (type !== 'coin' && type !== 'patch')) {
      return res.status(400).json({ error: 'Invalid or missing type' });
    }

    if (type === 'coin') {
      if (!frontDescription?.trim() || !backDescription?.trim()) {
        return res.status(400).json({ error: 'Both front and back descriptions are required for coin' });
      }
    } else {
      if (!patchDescription?.trim()) {
        return res.status(400).json({ error: 'Patch description is required' });
      }
    }

    // Helper: generate prompt with images (vision) or text only
    async function generatePromptWithImages(sideOrPatch, description, extraHint = '') {
      const userContent = `Description: ${description}. Shape: ${shape}. ${extraHint}`;

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
            content: `You are an expert ${type} designer. Create a DALL·E 3 prompt for the ${sideOrPatch}.
            - Analyze the reference images and the user's description.
            - The design must be centered, with sharp details.
            - Include appropriate textures and finishes.
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

    async function generatePromptTextOnly(sideOrPatch, description, extraHint = '') {
      const userContent = `Description: ${description}. Shape: ${shape}. ${extraHint}`;

      const textResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert ${type} designer. Create a DALL·E 3 prompt for the ${sideOrPatch}.
            - Expand the user's description into a detailed prompt.
            - Describe shape, symbols, inscriptions, and finish.
            - Output ONLY the prompt.`,
          },
          { role: 'user', content: userContent },
        ],
        max_tokens: 400,
        temperature: 0.7,
      });
      return textResponse.choices[0].message.content.trim();
    }

    // Determine prompts based on type
    let prompts = [];
    let imagesUsed = false;

    if (type === 'coin') {
      // Generate two prompts (front & back)
      if (imageFiles.length > 0) {
        imagesUsed = true;
        try {
          prompts = await Promise.all([
            generatePromptWithImages('front', frontDescription),
            generatePromptWithImages('back', backDescription),
          ]);
        } catch (visionError) {
          if (visionError.status === 400 && visionError.code === 'content_policy_violation') {
            console.warn('Vision safety error, falling back to text-only');
            imagesUsed = false;
            prompts = await Promise.all([
              generatePromptTextOnly('front', frontDescription),
              generatePromptTextOnly('back', backDescription),
            ]);
          } else {
            throw visionError;
          }
        }
      } else {
        prompts = await Promise.all([
          generatePromptTextOnly('front', frontDescription),
          generatePromptTextOnly('back', backDescription),
        ]);
      }
    } else {
      // Patch: single prompt, optionally include velcro
      const extraHint = velcro === 'yes' ? 'The patch has a velcro backing.' : '';
      if (imageFiles.length > 0) {
        imagesUsed = true;
        try {
          const prompt = await generatePromptWithImages('patch', patchDescription, extraHint);
          prompts = [prompt];
        } catch (visionError) {
          if (visionError.status === 400 && visionError.code === 'content_policy_violation') {
            console.warn('Vision safety error, falling back to text-only');
            imagesUsed = false;
            const prompt = await generatePromptTextOnly('patch', patchDescription, extraHint);
            prompts = [prompt];
          } else {
            throw visionError;
          }
        }
      } else {
        const prompt = await generatePromptTextOnly('patch', patchDescription, extraHint);
        prompts = [prompt];
      }
    }

    // Helper: generate image with retry on safety violation
    async function generateImageWithRetry(prompt, sideOrPatch, description, extraHint = '') {
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
          console.warn(`DALL·E safety error for ${sideOrPatch}, retrying with text-only prompt`);
          const textOnlyPrompt = await generatePromptTextOnly(sideOrPatch, description, extraHint);
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

    // Generate image(s)
    let imageUrls;
    if (type === 'coin') {
      const [frontPrompt, backPrompt] = prompts;
      const [frontUrl, backUrl] = await Promise.all([
        generateImageWithRetry(frontPrompt, 'front', frontDescription),
        generateImageWithRetry(backPrompt, 'back', backDescription),
      ]);
      imageUrls = { frontImageUrl: frontUrl, backImageUrl: backUrl };
    } else {
      const [patchPrompt] = prompts;
      const patchUrl = await generateImageWithRetry(patchPrompt, 'patch', patchDescription, velcro === 'yes' ? 'with velcro' : '');
      imageUrls = { patchImageUrl: patchUrl };
    }

    return res.status(200).json({
      success: true,
      type,
      ...imageUrls,
      shape,
      velcro: velcro || 'no',
      imagesUsed,
      message: imagesUsed ? null : 'Your reference images could not be processed due to safety filters. The design was generated based on your text descriptions only.',
    });
  } catch (error) {
    console.error('Generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate design',
    });
  }
}