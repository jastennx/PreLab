const path = require('path');
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

app.get('/', (_req, res) => {
  res.redirect('/pages/home.html');
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
      return res.status(400).json({ error: 'File is too large. Max size is 10MB.' });
    }
    return res.status(400).json({ error: err.message || 'File upload error' });
  }

  return res.status(err.status || 500).json({ error: err.message || 'Unexpected error' });
});

module.exports = app;
