import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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

async function generateWithGemini(promptText, imageFiles = []) {
  const parts = [{ text: promptText }];

  imageFiles.slice(0, 3).forEach(file => {
    parts.push({
      inline_data: {
        mime_type: file.mimetype,
        data: file.buffer.toString('base64')
      }
    });
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }]
      })
    }
  );

  const data = await response.json();

  if (!data.candidates || !data.candidates[0]) {
    throw new Error('No image generated');
  }

  const imagePart = data.candidates[0].content.parts.find(p => p.inline_data);

  if (!imagePart) {
    throw new Error('No image returned from Gemini');
  }

  return `data:${imagePart.inline_data.mime_type};base64,${imagePart.inline_data.data}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await runMiddleware(req, res, multerMiddleware);

    const { type, shape, frontDescription, backDescription, patchDescription, velcro } = req.body;
    const imageFiles = req.files || [];

    if (!type || (type !== 'coin' && type !== 'patch')) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    if (type === 'coin') {
      if (!frontDescription?.trim() || !backDescription?.trim()) {
        return res.status(400).json({ error: 'Both front and back required' });
      }

      const frontPrompt = `
Create a high-quality 3D ${shape} challenge coin front design.
Description: ${frontDescription}.
Centered composition. Sharp engraving details. Realistic metal texture.
`;

      const backPrompt = `
Create a high-quality 3D ${shape} challenge coin back design.
Description: ${backDescription}.
Centered composition. Sharp engraving details. Realistic metal texture.
`;

      const [frontImageUrl, backImageUrl] = await Promise.all([
        generateWithGemini(frontPrompt, imageFiles),
        generateWithGemini(backPrompt, imageFiles)
      ]);

      return res.status(200).json({
        success: true,
        type,
        frontImageUrl,
        backImageUrl,
        shape,
        velcro: 'no'
      });

    } else {
      if (!patchDescription?.trim()) {
        return res.status(400).json({ error: 'Patch description required' });
      }

      const extra = velcro === 'yes' ? 'Include velcro backing.' : '';

      const patchPrompt = `
Create a detailed embroidered unit patch design.
Shape: ${shape}.
Description: ${patchDescription}.
${extra}
Realistic stitching texture. Clean centered layout.
`;

      const patchImageUrl = await generateWithGemini(patchPrompt, imageFiles);

      return res.status(200).json({
        success: true,
        type,
        patchImageUrl,
        shape,
        velcro: velcro || 'no'
      });
    }

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Generation failed'
    });
  }
}