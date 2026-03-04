const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const apiRoutes = require('./routes/apiRoutes');

const app = express();

app.use(
  cors({
    origin: config.frontendUrl === '*' ? true : config.frontendUrl,
    credentials: true
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiRoutes);

const staticDir = path.join(config.rootDir, 'public');
app.use(express.static(staticDir));

app.get('/pages/:page', (req, res, next) => {
  const page = String(req.params.page || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(page)) return next();

  const htmlFile = path.join(staticDir, 'pages', `${page}.html`);
  if (!fs.existsSync(htmlFile)) return next();

  return res.sendFile(htmlFile);
});

app.get('/', (_req, res) => {
  const query = _req.url.includes('?') ? _req.url.slice(_req.url.indexOf('?')) : '';
  if (_req.query.code || _req.query.error) {
    return res.redirect(`/pages/signin${query}`);
  }
  res.redirect(`/pages/home${query}`);
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((err, req, res, _next) => {
  if (!req.path.startsWith('/api')) {
    return res.status(err.status || 500).send(err.message || 'Unexpected error');
  }

  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File is too large. Max size is 25MB.' });
    }
    return res.status(400).json({ error: err.message || 'File upload error' });
  }

  return res.status(err.status || 500).json({ error: err.message || 'Unexpected error' });
});

module.exports = app;
