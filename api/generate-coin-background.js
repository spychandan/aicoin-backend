export default function handler(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      method: req.method,
      hasApiKey: !!process.env.OPENAI_API_KEY,
      body: req.body || null
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
