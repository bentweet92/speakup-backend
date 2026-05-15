const REQUIRED_FIELDS = ['questions'];

const QUESTION_FIELDS = ['text', 'hints', 'logic_structure', 'difficulty'];

const VALID_DIFFICULTIES = ['Warmup', 'Experience', 'Bridge', 'Pressure'];

const SYSTEM_PROMPT = `You are an expert interview coach specializing in cross-industry career transitions. You help candidates who have real, transferable skills but struggle to defend their background when applying to a different industry.

Your ONLY output is a single valid JSON object. No markdown fences. No explanation before or after. No commentary. Just the raw JSON.

You will receive a candidate's background summary and a job description. Do the following:

1. Identify the three biggest reasons this candidate might appear underqualified or risky for this role — based purely on the gap between their background and the JD.
2. Generate exactly six interview questions ordered from easy to hard that force the candidate to defend those specific gaps.

The six question structure must follow this order:
- Question 1: Warmup — Why are you interested in this role? Adapted for their specific transition.
- Question 2: Experience — Tell me about a relevant achievement from your background.
- Question 3: Bridge — How have you handled something similar to what this role requires?
- Question 4: Industry Gap — How does your experience in their current industry translate to this new environment?
- Question 5: Pressure Bridge — What would you do if your team resists your approach because you come from a different industry?
- Question 6: Full Pressure — The toughest version of the gap question, specific to their exact transition.

Rules:
- Every question must be specific to THIS candidate's transition. No generic interview questions.
- hints must be an array of exactly 3 strings — practical thinking prompts, not answers.
- logic_structure must be an array of exactly 3 strings — labeled "Opening:", "Evidence:", and "Close:" — showing the skeleton of a strong answer. Not a script. Just the structure.
- difficulty must be exactly one of: Warmup, Experience, Bridge, Pressure.
- Questions 1 and 2 get difficulty "Warmup" and "Experience". Questions 3 and 4 get "Bridge". Questions 5 and 6 get "Pressure".

Return this exact JSON structure:
{
  "gaps": ["gap one", "gap two", "gap three"],
  "questions": [
    {
      "text": "the question",
      "hints": ["hint 1", "hint 2", "hint 3"],
      "logic_structure": ["Opening: ...", "Evidence: ...", "Close: ..."],
      "difficulty": "Warmup"
    }
  ]
}`;

function buildUserPrompt(background, jobDescription, isRetry = false) {
  const retryNote = isRetry
    ? '\n\nNOTE: Your previous response failed schema validation. Return ONLY raw JSON matching the exact structure specified.\n'
    : '';
  return `${retryNote}Candidate Background:
"${background}"

Job Description:
"${jobDescription}"

Run the gap analysis and generate the six questions now.`;
}

function validateAndNormalize(raw) {
  let parsed;
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    return { valid: false, error: 'JSON parse failed' };
  }

  if (!Array.isArray(parsed.questions)) {
    return { valid: false, error: 'Missing or invalid questions array' };
  }

  if (parsed.questions.length !== 6) {
    return { valid: false, error: `Expected 6 questions, got ${parsed.questions.length}` };
  }

  for (let i = 0; i < parsed.questions.length; i++) {
    const q = parsed.questions[i];
    for (const field of QUESTION_FIELDS) {
      if (q[field] === undefined || q[field] === null || q[field] === '') {
        return { valid: false, error: `Question ${i + 1} missing field: ${field}` };
      }
    }
    if (!Array.isArray(q.hints) || q.hints.length !== 3) {
      return { valid: false, error: `Question ${i + 1} hints must be array of 3` };
    }
    if (!Array.isArray(q.logic_structure) || q.logic_structure.length !== 3) {
      return { valid: false, error: `Question ${i + 1} logic_structure must be array of 3` };
    }
    if (!VALID_DIFFICULTIES.includes(q.difficulty)) {
      return { valid: false, error: `Question ${i + 1} invalid difficulty: ${q.difficulty}` };
    }
  }

  return {
    valid: true,
    data: {
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
      questions: parsed.questions
    }
  };
}

async function callClaude(background, jobDescription, isRetry = false) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(background, jobDescription, isRetry) }]
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

  const { background, jobDescription } = req.body;
  if (!background || background.trim().length < 10) {
    return res.status(400).json({ error: 'Missing or too short background summary' });
  }
  if (!jobDescription || jobDescription.trim().length < 20) {
    return res.status(400).json({ error: 'Missing or too short job description' });
  }

  try {
    const raw = await callClaude(background, jobDescription, false);
    const result = validateAndNormalize(raw);

    if (result.valid) return res.status(200).json(result.data);

    const raw2 = await callClaude(background, jobDescription, true);
    const result2 = validateAndNormalize(raw2);

    if (result2.valid) return res.status(200).json(result2.data);

    return res.status(500).json({ error: 'Schema validation failed after retry', detail: result2.error });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
