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
        // JSON request (for backward compatibility)
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

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Parse form data (supports both JSON and multipart)
    const formData = await parseFormData(req);
    
    const { description, engraving } = formData;
    const imageData = formData.image; // Could be base64 string or file object

    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }

    // Build the prompt
    let prompt = `
Highly realistic custom commemorative coin.
Design concept: ${description}
${engraving ? `Engraving text: ${engraving}` : 'No engraving text'}
Professional studio lighting, premium metal texture, dark background, highly detailed, 8k resolution.
`;

    // Prepare request body for OpenAI
    const requestBody = {
      model: "dall-e-3",
      prompt: prompt,
      size: "1024x1024",
      quality: "standard",
      n: 1
    };

    // If image is provided, we need to use the images.createVariation endpoint
    // Note: DALL-E 3 doesn't support image variations in the same way as DALL-E 2
    // We'll use the prompt with optional image reference in the description
    if (imageData) {
      // Add reference to uploaded image in the prompt
      prompt = `Based on the reference image provided, create: ${prompt}`;
      requestBody.prompt = prompt;
      
      // For DALL-E 2, we could use image variation, but for DALL-E 3 we include in prompt
      console.log("Image uploaded, filename:", imageData.filename || "reference image");
    }

    console.log("Sending prompt to OpenAI:", prompt);

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

    // For DALL-E 3, the response structure is different
    const imageUrl = data?.data?.[0]?.url;
    
    if (!imageUrl) {
      throw new Error("OpenAI returned no image data");
    }

    // Download the image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');

    return res.status(200).json({
      success: true,
      imageBase64: imageBase64,
      promptUsed: prompt
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