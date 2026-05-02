module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const assemblyKey = process.env.ASSEMBLYAI_API_KEY;
const { id } = req.query;
if (!id) return res.status(400).json({ error: 'Missing transcript id' });

  try {
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { 'authorization': assemblyKey }
    });

    if (!pollRes.ok) {
      const err = await pollRes.text();
      return res.status(502).json({ error: 'AssemblyAI error: ' + err });
    }

    const data = await pollRes.json();

    if (data.status === 'completed') return res.status(200).json({ status: 'completed', text: data.text });
    if (data.status === 'error') return res.status(502).json({ status: 'error', error: data.error });
    return res.status(200).json({ status: 'processing' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
