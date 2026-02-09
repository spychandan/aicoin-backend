const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function setCors(res) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

// Helper to parse multipart form data
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      
      // Check if it's multipart form data
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        // JSON request
        try {
          const body = JSON.parse(buffer.toString());
          resolve(body);
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
        return;
      }
      
      // Parse multipart form data
      const boundary = contentType.split('boundary=')[1];
      const parts = buffer.toString('binary').split(`--${boundary}`);
      
      const result = {};
      
      for (const part of parts) {
        if (part.includes('Content-Disposition')) {
          const nameMatch = part.match(/name="([^"]+)"/);
          const filenameMatch = part.match(/filename="([^"]+)"/);
          
          if (nameMatch) {
            const name = nameMatch[1];
            
            if (filenameMatch) {
              // File upload
              const filename = filenameMatch[1];
              const fileStart = part.indexOf('\r\n\r\n') + 4;
              const fileEnd = part.lastIndexOf('\r\n');
              const fileContent = part.substring(fileStart, fileEnd);
              
              // Convert to base64
              const base64Content = Buffer.from(fileContent, 'binary').toString('base64');
              
              result[name] = {
                filename: filename,
                data: base64Content,
                contentType: part.includes('Content-Type:') 
                  ? part.match(/Content-Type: ([^\r\n]+)/)[1]
                  : 'application/octet-stream'
              };
            } else {
              // Text field
              const valueStart = part.indexOf('\r\n\r\n') + 4;
              const valueEnd = part.lastIndexOf('\r\n');
              const value = part.substring(valueStart, valueEnd);
              result[name] = value;
            }
          }
        }
      }
      
      resolve(result);
    });
    req.on('error', reject);
  });
}

// Function to detect shape from description
function detectShapeFromDescription(description) {
  const desc = description.toLowerCase();
  const shapeKeywords = {
    'round': ['round', 'circle', 'circular', 'coin', 'medal'],
    'square': ['square', 'box', 'rectangular'],
    'triangle': ['triangle', 'triangular', 'pyramid'],
    'star': ['star', 'star-shaped'],
    'heart': ['heart', 'heart-shaped'],
    'oval': ['oval', 'elliptical', 'ellipse'],
    'crocodile': ['crocodile', 'alligator', 'reptile'],
    'dragon': ['dragon', 'mythical'],
    'shield': ['shield', 'kite', 'heater'],
    'custom': ['custom', 'unique', 'special']
  };

  for (const [shape, keywords] of Object.entries(shapeKeywords)) {
    if (keywords.some(keyword => desc.includes(keyword))) {
      return shape;
    }
  }
  
  return 'round';
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Parse form data
    const formData = await parseFormData(req);
    
    const { description, engraving, shapeType } = formData;
    const imageData = formData.image;

    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }

    // Determine final shape
    let finalShape = shapeType || detectShapeFromDescription(description);
    
    // Build the prompt - focusing on clean coin design
    let prompt = `
Create a clean, professional ${finalShape}-shaped coin design based on the following description:
"${description}"

IMPORTANT INSTRUCTIONS:
1. Generate ONLY the coin design itself
2. NO background - use pure white background
3. NO text like "commemorative coin" or any labels
4. NO studio lighting effects
5. Coin should be metallic looking
6. Design should fill most of the canvas
7. Keep it simple and elegant

${engraving ? `Include this engraving text: "${engraving}"` : ''}
${imageData ? 'Use the uploaded image as reference for the design style.' : ''}

The output should be a clean, standalone coin design on white background, ready for 3D rendering.
`;

    console.log("Generated prompt:", prompt);

    // Prepare request body for OpenAI
    const requestBody = {
      model: "dall-e-3",
      prompt: prompt,
      size: "1024x1024",
      quality: "hd",
      n: 1,
      style: "natural"
    };

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      throw new Error(data.error?.message || "OpenAI request failed");
    }

    // For DALL-E 3
    const imageUrl = data?.data?.[0]?.url;
    
    if (!imageUrl) {
      throw new Error("OpenAI returned no image data");
    }

    // Download the image and convert to base64
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error("Failed to download generated image");
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');

    return res.status(200).json({
      success: true,
      imageBase64: imageBase64,
      shape: finalShape,
      promptUsed: prompt.substring(0, 200) + "..." // Truncated for response
    });

  } catch (err) {
    console.error("Generation error:", err);
    return res.status(500).json({
      success: false,
      error: "Image generation failed",
      details: err.message,
    });
  }
}