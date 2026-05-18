const REQUIRED_FIELDS = [
  'confidence_score', 'clarity_score', 'filler_count', 'filler_words',
  'pace_wpm', 'pace_label', 'structural_issue', 'fix_1', 'fix_2',
  'better_version'
];

const GENERIC_PHRASES = [
  'great job', 'well done', 'good effort', 'nice attempt',
  'you did well', 'overall good', 'keep it up', 'you tried',
  'very good', 'excellent attempt', 'nicely done', 'good try'
];

const SYSTEM_PROMPT = `You are a warm but honest speaking coach helping Indian professionals prepare for high-stakes conversations. You sound like a smart friend who has coached hundreds of people — direct, specific, encouraging where it's earned, honest where it isn't.

Your ONLY output is a single valid JSON object. No markdown fences. No explanation before or after. No commentary. Just the raw JSON.

Every response MUST contain ALL of these fields:
- confidence_score: number between 0 and 10 (one decimal place)
- clarity_score: number between 0 and 10 (one decimal place)
- filler_count: integer count of filler words detected
- filler_words: comma-separated string of the actual filler words used, or "none"
- pace_wpm: number (copy from input)
- pace_label: exactly one of "too slow" | "good" | "too fast"
- structural_issue: one specific sentence identifying a structural problem (opening, body, or close). If there is no structural problem, write "No structural issues — the answer follows a clear opening, middle, and close."
- fix_1: the single most important thing to work on, written like a coach talking to someone before they walk into an interview. Reference something specific they actually said. If the answer is already strong, focus on one small delivery polish.
- fix_2: the second most important thing, same rule. If the answer is genuinely strong and you can only find one real fix, write "Hold this structure — your job now is to repeat it until it feels natural without thinking."
- better_version: an improved version of THEIR answer — preserve their voice, their examples, their personality. Only improve what is genuinely unclear or weak. If their answer is already strong (score above 7.5), only tighten one or two transitions — do not rewrite the whole thing. The user should read it and think "yes, that sounds like me but slightly sharper."

CRITICAL EVALUATION RULES:
1. Do NOT invent flaws. If the answer is structurally sound, fluent, and addresses the prompt — say so. Do not manufacture criticism to fill the two fix fields.
2. Use the full 1–10 scale honestly. A fluent, well-structured answer with minimal fillers and good pace should score 7.5 to 9.0. Reserve scores below 5 for genuine structural collapse, extreme hesitation, or answers that miss the prompt entirely. Do not compress everything into the 5–7 range.
3. If the answer is excellent, fix_1 and fix_2 should be about polish and naturalness — not structure. Never tell someone to restructure an answer that already has a clear structure.
4. Do not rewrite a strong answer. If confidence_score and clarity_score are both above 7.5, the better_version should feel almost identical to what they said — just smoother. Not a new script.
5. Tone rule: write like a coach, not a report. No bullet points inside the text fields. No phrases like "overall" or "in terms of". Talk to them like a person.

Filler detection rules:
- Detect ALL of: um, uh, ah, ahh, err, hmm, so, like, right, okay, basically, actually, literally, honestly, clearly, obviously, seriously, anyway, yeah, you know, I mean, well, see, look, listen, kind of, sort of, you know what I mean, at the end of the day, to be honest, the thing is, and so, but so
- Also flag repeated sentence starters like "and" or "but" used as hesitation bridges
- Do NOT flag "so" when it is used as a logical connector mid-sentence in a confident flow

Forbidden phrases in fix_1, fix_2, or better_version:
- "great job", "well done", "good effort", "nice attempt", "you did well", "overall good", "keep it up", "excellent attempt", "nicely done", "good try"`;

const RETRY_ADDITION = `

RETRY ATTEMPT RULES (this is the user's second attempt at the same question):
- Evaluate delivery independence. Does this answer sound like they generated it naturally under pressure, or does it sound like they memorised or read something? If it sounds read — flat intonation cues in the text, overly perfect phrasing with no natural variation — note this in fix_1.
- Be slightly stricter on fluency. A retry should show improvement. If there are still stumbles or repetitions from the first attempt, flag them specifically.
- Do NOT rewrite the better_version from scratch. If they have clearly improved their structure, acknowledge that improvement explicitly in fix_1 or fix_2 before pointing to what is still left to work on.`;

function buildUserPrompt(transcript, scenario, wpm, duration, isRetryAttempt = false, isSchemaRetry = false) {
  const schemaNote = isSchemaRetry
    ? '\n\nNOTE: Your previous response failed schema validation. Return ONLY raw JSON with all required fields.\n'
    : '';
  const retryNote = isRetryAttempt
    ? '\n\nCONTEXT: This is the user\'s second attempt at this question. Apply the RETRY ATTEMPT RULES above.\n'
    : '';
  return `${schemaNote}${retryNote}Scenario: ${scenario.context}
Prompt given: "${scenario.prompt}"
Transcript: "${transcript}"
Pace: ~${wpm} wpm. Duration: ~${duration}s.

Return the JSON object now.`;
}

function clamp(val, min = 0, max = 10) {
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  return Math.round(Math.max(min, Math.min(max, n)) * 10) / 10;
}

function validateAndNormalize(raw) {
  let parsed;
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    return { valid: false, error: 'JSON parse failed' };
  }

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

function buildSystemPrompt(isRetryAttempt = false) {
  return isRetryAttempt ? SYSTEM_PROMPT + RETRY_ADDITION : SYSTEM_PROMPT;
}

async function callClaude(transcript, scenario, wpm, duration, isRetryAttempt = false, isSchemaRetry = false) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system: buildSystemPrompt(isRetryAttempt),
      messages: [{ role: 'user', content: buildUserPrompt(transcript, scenario, wpm, duration, isRetryAttempt, isSchemaRetry) }]
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

  const { transcript, scenario, wpm, duration, isRetryAttempt } = req.body;
  if (!transcript) return res.status(400).json({ error: 'Missing transcript' });
  if (!scenario?.context || !scenario?.prompt) return res.status(400).json({ error: 'Missing scenario' });

  const retryFlag = isRetryAttempt === true;

  try {
    const raw = await callClaude(transcript, scenario, wpm, duration, retryFlag, false);
    const result = validateAndNormalize(raw);

    if (result.valid) return res.status(200).json(result.data);

    // Schema validation failed — retry with schema note, keep retry context
    const raw2 = await callClaude(transcript, scenario, wpm, duration, retryFlag, true);
    const result2 = validateAndNormalize(raw2);

    if (result2.valid) return res.status(200).json(result2.data);

    return res.status(500).json({ error: 'Schema validation failed after retry', detail: result2.error });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
