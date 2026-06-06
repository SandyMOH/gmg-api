require('dotenv').config();
const ArloClient = require('./arloClient');
const WpClient = require('./wpClient');
const Geocoder = require('./geocoder');

const arlo = new ArloClient({
  clientId: process.env.ARLO_CLIENT_ID,
  clientSecret: process.env.ARLO_CLIENT_SECRET,
  platform: process.env.ARLO_PLATFORM,
  refreshToken: process.env.ARLO_REFRESH_TOKEN,
});

const wp = new WpClient({
  url: process.env.WP_URL,
  user: process.env.WP_USER,
  appPassword: process.env.WP_APP_PASSWORD,
});

const geocoder = new Geocoder(process.env.GOOGLE_API_KEY);

module.exports = { arlo, wp, geocoder };