require('dotenv').config();
const express = require('express');
const { log } = require('./lib/logger');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

// Import your new route files
const syncRoutes = require('./routes/sync');
const arloRoutes = require('./routes/arlo');
const systemRoutes = require('./routes/system');
const sprayingRoutes = require('./routes/spraying');
const testRoutes = require('./routes/test');
const applicantRoutes = require('./routes/applicant');
const { requireApiSecret } = require('./middleware/apiSecret');
const authRoutes = require('./routes/auth');
const reviewRoutes = require('./routes/review');
const uploadRoutes = require('./routes/upload');
const { initTables } = require('./lib/db'); 

const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.json());
app.use((req, res, next) => {
  log(`${req.method} ${req.path}`);
  next();
});


app.use('/', systemRoutes);                 

app.use('/', systemRoutes);
app.use('/api/auth', authRoutes);            
app.use('/api/applicants', requireApiSecret, applicantRoutes);  
app.use('/api/reviews', reviewRoutes);        
app.use('/api/uploads', uploadRoutes);        
app.use('/api/syncs', syncRoutes);           
app.use('/api/spraying', sprayingRoutes);     
app.use('/api/arlo', arloRoutes);

if (process.env.NODE_ENV !== "production") {
  app.use('/tests', testRoutes);
}

async function start() {
  await initTables();
  app.listen(PORT, () => {
    log('');
    log('========================================');
    log(`  GMG API — port ${PORT}`);
    log('========================================');
    log('');
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});