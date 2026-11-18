export default async function handler(req, res) {
  // POSTメソッドのみ許可
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method Not Allowed' } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'サーバーに GEMINI_API_KEY が設定されていません。VercelのEnvironment Variablesを確認してください。' }
    });
  }

  const { model, payload } = req.body || {};
  if (!model || !payload) {
    return res.status(400).json({ error: { message: 'model および payload は必須です。' } });
  }

  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const geminiResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseText = await geminiResponse.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { raw: responseText };
    }

    return res.status(geminiResponse.status).json(data);
  } catch (error) {
    console.error('Gemini proxy error:', error);
    return res.status(500).json({
      error: { message: error?.message || 'Gemini APIへの通信中にエラーが発生しました。' }
    });
  }
}
