module.exports = function handler(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      method: req.method,
      headers: req.headers,
      body: req.body,
      env: {
        hasKey: !!process.env.OPENAI_API_KEY
      }
    });
  } catch (e) {
    return res.status(500).json({
      crash: true,
      message: e.message,
      stack: e.stack
    });
  }
};
