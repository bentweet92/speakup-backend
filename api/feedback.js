module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transcript, scenario, wpm, duration } = req.body;
  if (!transcript) return res.status(400).json({ error: 'Missing transcript' });

  const prompt = `You are a brutally honest spoken English coach for Indian professionals preparing for job interviews and workplace communication.

Scenario: ${scenario.context}
Prompt given: "${scenario.prompt}"

What the person said (transcribed from audio):
"${transcript}"

Estimated pace: ~${wpm} words/minute. Duration: ~${duration} seconds.

Analyse this speech and return ONLY a valid JSON object (no markdown, no explanation outside the JSON):

{
  "confidence_score": <number 1-10>,
  "clarity_score": <number 1-10>,
  "filler_count": <count of ums, uhs, likes, you knows, so, basically, actually>,
  "filler_words": <comma-separated list>,
  "pace_wpm": ${wpm},
  "pace_label": <"too slow" | "good" | "too fast">,
  "fix_1": <most important fix, specific>,
  "fix_2": <second fix, specific>,
  "better_version": <rewrite as confident speaker, 3-5 sentences>,
  "overall_score": <average of confidence and clarity, one decimal>
}`;

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
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await aiRes.json();
    const raw = data.content[0].text;
    const clean = raw.replace(/```json|```/g, '').trim();
    const feedback = JSON.parse(clean);
    return res.status(200).json(feedback);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
