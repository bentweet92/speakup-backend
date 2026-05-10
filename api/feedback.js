const REQUIRED_FIELDS = [
  'confidence_score', 'clarity_score', 'filler_count', 'filler_words',
  'pace_wpm', 'pace_label', 'structural_issue', 'fix_1', 'fix_2',
  'better_version', 'top_1pct_version'
];

const REQUIRED_FIELDS = [
  'confidence_score', 'clarity_score', 'filler_count', 'filler_words',
  'pace_wpm', 'pace_label', 'structural_issue', 'fix_1', 'fix_2',
  'better_version', 'top_1pct_version'
];

const GENERIC_PHRASES = [
  'great job', 'well done', 'good effort', 'nice attempt',
  'you did well', 'overall good', 'keep it up', 'you tried',
  'very good', 'excellent attempt', 'nicely done', 'good try'
];

const SYSTEM_PROMPT = `You are a professional spoken English coach helping Indian professionals practice high-stakes conversations in a judgment-free environment. Your role is to be honest but encouraging — like a skilled editor, not a harsh examiner.

Your ONLY output is a single valid JSON object. No markdown fences. No explanation before or after. No commentary. Just the raw JSON.

Every response MUST contain ALL of these fields:
- confidence_score: number between 0 and 10 (one decimal place)
- clarity_score: number between 0 and 10 (one decimal place)
- filler_count: integer count of filler words detected
- filler_words: comma-separated string of the actual filler words used, or "none"
- pace_wpm: number (copy from input)
- pace_label: exactly one of "too slow" | "good" | "too fast"
- structural_issue: one specific sentence identifying a structural problem (opening, body, or close)
- fix_1: the single most important fix, written as a friendly instruction, anchored to something specific they said
- fix_2: the second most important fix, same rule
- better_version: an improved version of THEIR answer — preserve their original intent, tone, and personality. Keep their good points and strengthen them. Only replace what is genuinely unclear or hurts their message. The result should feel like a skilled editor improved their words, not like someone else answered entirely. The user should read it and think "yes that sounds like me but clearer and more confident."
- top_1pct_version: how a truly exceptional communicator would handle this same situation — this can be more different from their answer, showing them what mastery looks like

Rules:
- filler_count and filler_words must detect ALL of the following: um, uh, ah, ahh, err, hmm, so, like, right, okay, basically, actually, literally, honestly, clearly, obviously, seriously, anyway, yeah, you know, I mean, well, see, look, listen, kind of, sort of, you know what I mean, at the end of the day, to be honest, the thing is, and so, but so. Also flag sentences that start with "and" or "but" repeatedly as a hesitation pattern.
- fix_1 and fix_2 must reference specific words or phrases from the transcript. Never generic.
- Do NOT use phrases like "great job", "well done", "good effort", or any unearned praise.
- structural_issue must name the exact structural problem, not just say "structure needs work".
- The better_version must sound like the user, not like a corporate robot. Preserve their voice.
- If something they said was genuinely good, say so in fix_1 or fix_2 and build on it rather than ignoring it.`;

  for (const field of REQUIRED_FIELDS) {
    if (parsed[field] === undefined || parsed[field] === null || parsed[field] === '') {
      return { valid: false, error: `Missing field: ${field}` };
    }
  }

  const confidence_score = clamp(parsed.confidence_score);
  const clarity_score = clamp(parsed.clarity_score);
  if (confidence_score === null || clarity_score === null) {
    return { valid: false, error: 'Invalid score values' };
  }

  if (!['too slow', 'good', 'too fast'].includes(parsed.pace_label)) {
    return { valid: false, error: 'Invalid pace_label' };
  }

  // Generic feedback filter
  const combinedText = [parsed.fix_1, parsed.fix_2, parsed.better_version].join(' ').toLowerCase();
  const isGeneric = GENERIC_PHRASES.some(phrase => combinedText.includes(phrase));

  const overall_score = Math.round(((confidence_score + clarity_score) / 2) * 10) / 10;

  return {
    valid: true,
    data: {
      ...parsed,
      confidence_score,
      clarity_score,
      overall_score,
      pace_wpm: parseInt(parsed.pace_wpm) || 0,
      filler_count: parseInt(parsed.filler_count) || 0,
      is_generic_feedback: isGeneric
    }
  };
}

async function callClaude(transcript, scenario, wpm, duration, isRetry = false) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(transcript, scenario, wpm, duration, isRetry) }]
    })
  });
  const data = await res.json();
  if (!data.content?.[0]?.text) throw new Error('Empty Claude response');
  return data.content[0].text;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transcript, scenario, wpm, duration } = req.body;
  if (!transcript) return res.status(400).json({ error: 'Missing transcript' });
  if (!scenario?.context || !scenario?.prompt) return res.status(400).json({ error: 'Missing scenario' });

  try {
    const raw = await callClaude(transcript, scenario, wpm, duration, false);
    const result = validateAndNormalize(raw);

    if (result.valid) return res.status(200).json(result.data);

    // One retry
    const raw2 = await callClaude(transcript, scenario, wpm, duration, true);
    const result2 = validateAndNormalize(raw2);

    if (result2.valid) return res.status(200).json(result2.data);

    return res.status(500).json({ error: 'Schema validation failed after retry', detail: result2.error });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
