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
          // Handle JSON request (fallback)
          try {
            const body = JSON.parse(buffer.toString());
            resolve(body);
          } catch (e) {
            reject(new Error('Invalid request format'));
          }
          return;
        }
        
        // Parse multipart form data
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
                // It's a file upload
                const filename = filenameMatch[1];
                
                // Find where the file content starts (after double CRLF)
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
                // It's a regular form field
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

// Function to analyze image and extract description
async function analyzeImageWithOpenAI(imageBase64) {
  try {
    // For now, we'll just use a placeholder since GPT-4 Vision requires a different approach
    // In production, you'd use:
    // const response = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     model: "gpt-4-vision-preview",
    //     messages: [{
    //       role: "user",
    //       content: [
    //         { type: "text", text: "Describe this image in detail for coin design generation." },
    //         { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } }
    //       ]
    //     }],
    //     max_tokens: 300
    //   })
    // });
    
    // For now, return a placeholder
    return "Based on the uploaded reference image, create a detailed coin design that matches the style, patterns, and elements shown in the image.";
  } catch (error) {
    console.error('Image analysis error:', error);
    return "Using the uploaded image as reference for the coin design.";
  }
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
    const formData = await parseMultipartFormData(req);
    
    const description = formData.description;
    const imageData = formData.image;
    
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({ 
        success: false,
        error: "Description is required"
      });
    }

    // Build the prompt
    let prompt = description.trim();
    
    // If there's an image, include it in the prompt
    if (imageData && imageData.data) {
      try {
        // Analyze the image to understand its content
        const imageAnalysis = await analyzeImageWithOpenAI(imageData.data);
        
        // Construct a detailed prompt that combines the description and image analysis
        prompt = `Create a detailed coin design based on this description: "${description}"
        
        Important Reference from uploaded image: ${imageAnalysis}
        
        IMPORTANT REQUIREMENTS:
        1. Create ONLY the coin design itself
        2. Pure white background - NO background elements
        3. NO text labels or watermarks
        4. NO studio lighting effects or shadows
        5. The coin should be centered
        6. Design should be clear and detailed
        7. Make it look like a real metal coin
        8. The design should match the reference image style closely
        
        Output a clean, professional coin design on white background.`;
      } catch (imgError) {
        console.error('Image processing error:', imgError);
        // Fallback to simple prompt
        prompt = `Create a coin design based on: "${description}"
        Using the uploaded image as reference. White background only, no text labels.`;
      }
    } else {
      // No image, just description
      prompt = `Create a detailed coin design based on: "${description}"
      
      IMPORTANT REQUIREMENTS:
      1. Create ONLY the coin design itself
      2. Pure white background - NO background elements
      3. NO text labels like "commemorative coin" or watermarks
      4. NO studio lighting effects or shadows
      5. The coin should be centered
      6. Design should be clear and detailed
      7. Make it look like a real metal coin
      8. Consider the shape described (round, star, animal, etc.)
      
      Output a clean, professional coin design on white background.`;
    }

    console.log('Generated Prompt:', prompt.substring(0, 200) + '...');

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: prompt,
        size: "1024x1024",
        quality: "standard",
        n: 1,
        style: "natural",
        response_format: "b64_json"
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI API error:', data);
      throw new Error(data.error?.message || 'OpenAI request failed');
    }

    const imageBase64 = data?.data?.[0]?.b64_json;
    
    if (!imageBase64) {
      throw new Error('No image data received from OpenAI');
    }

    return res.status(200).json({
      success: true,
      imageBase64: imageBase64,
      promptUsed: prompt.substring(0, 300) + '...'
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