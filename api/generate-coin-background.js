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
async function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    req.on('data', chunk => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        
        if (!contentType.includes('multipart/form-data')) {
          try {
            const body = JSON.parse(buffer.toString());
            resolve(body);
          } catch (e) {
            reject(new Error('Invalid request format'));
          }
          return;
        }
        
        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
          reject(new Error('No boundary found'));
          return;
        }
        
        const parts = buffer.toString('binary').split(`--${boundary}`);
        const result = {};
        
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          
          if (part.includes('Content-Disposition')) {
            const nameMatch = part.match(/name="([^"]+)"/);
            const filenameMatch = part.match(/filename="([^"]+)"/);
            
            if (nameMatch) {
              const name = nameMatch[1];
              
              if (filenameMatch) {
                const filename = filenameMatch[1];
                const headerEnd = part.indexOf('\r\n\r\n');
                if (headerEnd !== -1) {
                  const fileStart = headerEnd + 4;
                  const fileEnd = part.lastIndexOf('\r\n');
                  if (fileEnd > fileStart) {
                    const fileContent = part.substring(fileStart, fileEnd);
                    const base64Content = Buffer.from(fileContent, 'binary').toString('base64');
                    
                    result[name] = {
                      filename: filename,
                      data: base64Content,
                      contentType: part.includes('Content-Type:') 
                        ? part.match(/Content-Type:\s*([^\r\n]+)/)[1]
                        : 'application/octet-stream'
                    };
                  }
                }
              } else {
                const headerEnd = part.indexOf('\r\n\r\n');
                if (headerEnd !== -1) {
                  const valueStart = headerEnd + 4;
                  const valueEnd = part.lastIndexOf('\r\n');
                  if (valueEnd > valueStart) {
                    const value = part.substring(valueStart, valueEnd);
                    result[name] = value;
                  }
                }
              }
            }
          }
        }
        
        resolve(result);
      } catch (error) {
        reject(error);
      }
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
    const formData = await parseMultipartFormData(req);
    
    const description = formData.description;
    const imageData = formData.image;
    
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "Description is required"
      });
    }

    // CRITICAL: Use the simple, effective prompt that was working
    let prompt = `Highly realistic single commemorative coin`;
    
    // Add description
    prompt += ` featuring: ${description}.`;
    
    // If image is provided, mention it
    if (imageData && imageData.data) {
      prompt += ` Use the uploaded reference image as inspiration.`;
    }
    
    // Add the key specifications that were working before
    prompt += ` Studio lighting, premium metal texture, dark background, centered composition, single coin only, no text labels.`;
    
    console.log('Prompt:', prompt);

    // Try DALL-E 3 first, fall back to DALL-E 2 if needed
    const models = ["dall-e-3", "dall-e-2"];
    let imageBase64 = null;
    let lastError = null;
    
    for (const model of models) {
      try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: model,
            prompt: prompt,
            size: model === "dall-e-3" ? "1024x1024" : "1024x1024",
            quality: "standard",
            n: 1,
            style: "natural",
            response_format: "b64_json"
          }),
        });

        const data = await response.json();
        
        if (response.ok && data?.data?.[0]?.b64_json) {
          imageBase64 = data.data[0].b64_json;
          console.log(`Successfully generated image with ${model}`);
          break;
        } else {
          lastError = data.error?.message || `Failed with ${model}`;
          console.log(`Failed with ${model}:`, lastError);
        }
      } catch (error) {
        lastError = error.message;
        console.log(`Error with ${model}:`, error.message);
      }
    }
    
    if (!imageBase64) {
      throw new Error(lastError || 'All model attempts failed');
    }

    return res.status(200).json({
      success: true,
      imageBase64: imageBase64
    });

  } catch (err) {
    console.error('Generation error:', err);
    return res.status(500).json({
      success: false,
      error: "Image generation failed",
      details: err.message,
    });
  }
}