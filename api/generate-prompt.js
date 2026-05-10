module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { situation } = req.body;
  if (!situation) return res.status(400).json({ error: 'Missing situation' });

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: `You create practice prompts for a speech rehearsal app. Given a situation someone wants to practice, return ONLY a valid JSON object with no markdown, no backticks, no explanation. The JSON must have exactly these fields:
- prompt: a realistic, specific speaking prompt for this situation (1-2 sentences, written as a direct instruction to the user)
- hints: array of exactly 3 short coaching hints for this specific situation
- structure: the ideal answer structure as a short phrase like "Opening → Main point → Close"

Make the prompt feel real and emotionally grounded, not like a textbook exercise. Keep it under 45 seconds to answer.`,
        messages: [{
          role: 'user',
          content: `Create a practice prompt for this situation: ${situation}`
        }]
      })
    });

    const data = await aiRes.json();
    const raw = data.content[0].text;
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
