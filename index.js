require('dotenv').config();
const express = require('express');
const { log } = require('./lib/logger');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

// Import your new route files
const syncRoutes = require('./routes/sync');
const webhookRoutes = require('./routes/webhook');
const systemRoutes = require('./routes/system');
const sprayingRoutes = require('./routes/spraying');
const testRoutes = require('./routes/test');
const applicantRoutes = require('./routes/applicant');
const authRoutes = require('./routes/auth');
const reviewRoutes = require('./routes/review');
const uploadRoutes = require('./routes/upload');


const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.json());

// Mount the routers to their base paths
app.use('/', systemRoutes);                  // Handles '/', '/api/status', '/api/logs'

app.use('/api/sync', syncRoutes);            // Handles '/api/sync', '/api/sync/dry', '/api/sync/history'
app.use('/api/spraying', sprayingRoutes);    // Handles '/api/spraying/approve'
app.use('/webhook', webhookRoutes);          // Handles '/webhook', '/api/webhook/history'
app.use('/applicant', applicantRoutes);      // Handles '/applicant/:id'
app.use('/api/auth', authRoutes);          // Handles '/api/auth/reviewer-token'
app.use('/api/upload', uploadRoutes);      // Handles '/api/upload'
app.use('/api/review', reviewRoutes);     // Handles '/api/review/submit', '/api/review/history'
app.use('/test', testRoutes);                // Handles '/test', '/test/email'

app.listen(PORT, () => {
  log('');
  log('========================================');
  log(`  GMG API — port ${PORT}`);
  log('========================================');
  log('');
});