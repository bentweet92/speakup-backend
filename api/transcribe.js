async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

 const assemblyKey = process.env.ASSEMBLYAI_API_KEY;

  try {
    const audioBuffer = await readBody(req);
    if (!audioBuffer.length) return res.status(400).json({ error: 'Empty audio' });

    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'authorization': assemblyKey,
        'content-type': 'application/octet-stream'
      },
      body: audioBuffer
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return res.status(502).json({ error: 'Upload failed: ' + err });
    }

    const { upload_url } = await uploadRes.json();

    const transcribeRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'authorization': assemblyKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ audio_url: upload_url, speech_models: ['universal-2'] })
    });

    if (!transcribeRes.ok) {
      const err = await transcribeRes.text();
      return res.status(502).json({ error: 'Job submit failed: ' + err });
    }

    const { id } = await transcribeRes.json();
    return res.status(200).json({ id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
