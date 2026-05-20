const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NETLIFY_SITE = 'https://frabjous-otter-2760eb.netlify.app';

app.use(cors());
app.use(express.json());

// Proxy endpoint for Anthropic API  
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error: API key not set' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: req.body.model || 'claude-sonnet-4-5',
        max_tokens: req.body.max_tokens || 1024,
        system: req.body.system || '',
        messages: req.body.messages || [],
        ...(req.body.tools && { tools: req.body.tools }),
        ...(req.body.tool_choice && { tool_choice: req.body.tool_choice })
      })
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy all other requests to the Netlify site's static files
// This lets us use Netlify for static hosting and Render just for the API
app.use(async (req, res) => {
  try {
    const url = NETLIFY_SITE + req.path + (req.path === '/' ? '' : '');
    const response = await fetch(url, {
      headers: { 'Accept': req.headers.accept || '*/*' }
    });
    
    if (!response.ok && response.status !== 200) {
      // Try index.html for SPA routing
      const indexResp = await fetch(NETLIFY_SITE + '/index.html');
      const html = await indexResp.text();
      // Patch the API_URL in the proxied HTML
      const patched = html.replace(
        'const API_URL = "https://api.anthropic.com/v1/messages"',
        'const API_URL = "/api/claude"'
      ).replace(
        'const ANTHROPIC_VERSION = ',
        '// const ANTHROPIC_VERSION = '
      );
      return res.type('html').send(patched);
    }
    
    const contentType = response.headers.get('Content-Type') || 'text/plain';
    res.set('Content-Type', contentType);
    
    if (contentType.includes('text/html')) {
      const html = await response.text();
      const patched = html.replace(
        'const API_URL = "https://api.anthropic.com/v1/messages"',
        'const API_URL = "/api/claude"'
      );
      res.send(patched);
    } else {
      response.body.pipe(res);
    }
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log('Plainly server running on port ' + PORT);
});
