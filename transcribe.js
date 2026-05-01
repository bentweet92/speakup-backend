function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-assembly-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const assemblyKey = req.headers['x-assembly-key'];
  if (!assemblyKey) return res.status(400).json({ error: 'Missing AssemblyAI key' });

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
      body: JSON.stringify({ audio_url: upload_url, language_code: 'en' })
    });

    if (!transcribeRes.ok) {
      const err = await transcribeRes.text();
      return res.status(502).json({ error: 'Job submit failed: ' + err });
    }

    const { id } = await transcribeRes.json();

    for (let i = 0; i < 60; i++) {
      await sleep(3000);
      const pollRes = await fetch('https://api.assemblyai.com/v2/transcript/' + id, {
        headers: { 'authorization': assemblyKey }
      });
      const data = await pollRes.json();
      if (data.status === 'completed') return res.status(200).json({ transcript: data.text });
      if (data.status === 'error') return res.status(502).json({ error: 'AssemblyAI: ' + data.error });
    }

    return res.status(504).json({ error: 'Timed out waiting for transcript' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
