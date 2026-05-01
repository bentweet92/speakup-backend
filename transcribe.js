export const config = { api: { bodyParser: false } };

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  // CORS headers — allow your GitHub Pages domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-assembly-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const assemblyKey = req.headers['x-assembly-key'];
  if (!assemblyKey) return res.status(400).json({ error: 'Missing AssemblyAI key' });

  try {
    // 1. Read audio buffer from request body
    const audioBuffer = await readBody(req);
    if (!audioBuffer.length) return res.status(400).json({ error: 'Empty audio' });

    // 2. Upload to AssemblyAI
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'authorization': assemblyKey,
        'content-type': 'application/octet-stream',
        'transfer-encoding': 'chunked'
      },
      body: audioBuffer
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return res.status(502).json({ error: 'Upload failed: ' + err });
    }

    const { upload_url } = await uploadRes.json();

    // 3. Submit transcription job
    const transcribeRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'authorization': assemblyKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        audio_url: upload_url,
        language_code: 'en'
      })
    });

    if (!transcribeRes.ok) {
      const err = await transcribeRes.text();
      return res.status(502).json({ error: 'Transcription submit failed: ' + err });
    }

    const { id } = await transcribeRes.json();

    // 4. Poll until complete (server-side, no CORS issue)
    for (let i = 0; i < 60; i++) {
      await sleep(3000);
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { 'authorization': assemblyKey }
      });
      const data = await pollRes.json();

      if (data.status === 'completed') {
        return res.status(200).json({ transcript: data.text });
      }
      if (data.status === 'error') {
        return res.status(502).json({ error: 'AssemblyAI error: ' + data.error });
      }
      // still processing — keep polling
    }

    return res.status(504).json({ error: 'Transcription timed out server-side' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
