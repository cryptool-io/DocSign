require('./config/env');

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const { sequelize } = require('./models');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = parseInt(process.env.PORT || '4400', 10);

app.set('trust proxy', 1); // behind nginx on the server

app.use(
  helmet({
    contentSecurityPolicy: false, // the SPA + PDF worker set their own; API is JSON
    crossOriginResourcePolicy: { policy: 'same-site' }
  })
);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      // Same-origin / server-to-server requests have no Origin header.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'cto-docsign', time: new Date().toISOString() }));

// --- API routers ---------------------------------------------------------
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/projects', require('./routes/projectRoutes'));
app.use('/api/documents', require('./routes/documentRoutes'));
app.use('/api/recipients', require('./routes/recipientRoutes'));
app.use('/api/recipient-groups', require('./routes/recipientGroupRoutes'));
app.use('/api/templates', require('./routes/templateRoutes'));
app.use('/api/links', require('./routes/linkRoutes'));
app.use('/api/envelopes', require('./routes/envelopeRoutes'));
app.use('/api/data-rooms', require('./routes/dataRoomRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// Public recipient-facing surface (no app login; own tokens).
app.use('/api/view', require('./routes/publicViewRoutes'));
app.use('/api/sign', require('./routes/publicSignRoutes'));
app.use('/api/room', require('./routes/publicDataRoomRoutes'));

// --- Static SPA (built web/) ---------------------------------------------
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA history fallback for anything that isn't an API route.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use('/api', notFoundHandler);
app.use(errorHandler);

const start = async () => {
  try {
    await sequelize.authenticate();
    console.log('[docsign] database connection OK');
  } catch (err) {
    console.error('[docsign] database connection FAILED:', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`[docsign] API listening on http://localhost:${PORT}`);
    console.log(`[docsign] storage driver: ${process.env.DOCROOM_STORAGE_DRIVER || 's3'}`);
  });
};

if (require.main === module) start();

module.exports = app;
