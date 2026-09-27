require('dotenv').config();

const { log } = require('./lib/logger');
const ArloClient = require('./lib/arloClient');
const WpClient = require('./lib/wpClient');
const Geocoder = require('./lib/geocoder');
const { runSync } = require('./lib/syncRunner');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  log('========================================');
  log(`  GMG API - Bulk Sync (CLI)${DRY_RUN ? ' (DRY RUN)' : ''}`);
  log('========================================');

  const arlo = new ArloClient({
    clientId: process.env.ARLO_CLIENT_ID,
    clientSecret: process.env.ARLO_CLIENT_SECRET,
    platform: process.env.ARLO_PLATFORM,
  });

  const wp = new WpClient({
    url: process.env.WP_URL,
    user: process.env.WP_USER,
    appPassword: process.env.WP_APP_PASSWORD,
  });

  const geocoder = new Geocoder(process.env.GOOGLE_API_KEY);

  const result = await runSync(arlo, wp, geocoder, { dryRun: DRY_RUN });

  if (!result.success) {
    log('Sync failed with errors:');
    result.errors.forEach((e) => log(`  - ${e}`));
    process.exit(1);
  }
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  console.error(err);
  process.exit(1);
});
