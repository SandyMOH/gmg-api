/**
 * syncRunner.js
 *
 * The bulk sync logic extracted into a function.
 * Called by:
 *   - sync.js (CLI: npm run sync)
 *   - index.js (API: POST /api/sync)
 *
 * Returns a structured result object for the UI.
 */

const { log } = require('./logger');
const { processApplicator } = require('./processor');
const { sendErrorAlert } = require('./emailSender');

async function runSync(arlo, wp, geocoder, options = {}) {
  const { dryRun = false } = options;
  const startTime = Date.now();

  const result = {
    success: true,
    dryRun,
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: 0,
    registrations: {
      fetched: 0,
      sprayAcademy: 0,
      passed: 0,
    },
    wordpress: {
      existingPosts: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
    },
    applicants: [],
    errors: [],
  };

  try {
    // 1. Authenticate
    log('Authenticating with Arlo...');
    const authOk = await arlo.authenticate();
    if (!authOk) {
      result.success = false;
      result.errors.push('Arlo authentication failed');
      await sendErrorAlert('Arlo Authentication', 'Arlo OAuth token refresh failed. The refresh token may be expired or revoked.');
      return result;
    }
    log('  Authenticated');

    // 2. Fetch completed registrations
    log('Fetching completed registrations...');
    let registrations;
    try {
      registrations = await arlo.fetchCompletedRegistrations();
    } catch (err) {
      result.success = false;
      result.errors.push(`Failed to fetch registrations: ${err.message}`);
      await sendErrorAlert('Fetch Completed Registrations', err.message);
      return result;
    }
    result.registrations.fetched = registrations.length;
    log(`  Found ${registrations.length} completed registrations`);

    // 3. Fetch existing WP posts
    log('Fetching existing WordPress posts...');
    let existingPosts;
    try {
      existingPosts = await wp.getAllApplicators();
    } catch (err) {
      result.success = false;
      result.errors.push(`Failed to fetch WP posts: ${err.message}`);
      return result;
    }
    result.wordpress.existingPosts = existingPosts.length;
    log(`  Found ${existingPosts.length} existing posts`);

    // 4. Process each registration
    log('');
    log('Processing registrations...');

    for (const reg of registrations) {
      const data = arlo.extractApplicator(reg);

      const processResult = await processApplicator(
        data,
        { wp, geocoder },
        { dryRun, existingPosts }
      );

      // Build applicant record for the response
      const applicantInfo = {
        name: data ? `${data.firstName} ${data.lastName}`.trim() : 'Unknown',
        email: data?.email || '',
        company: data?.company || '',
        courseCode: data?.courseCode || '',
        outcome: data?.outcome || '',
        action: null,
        error: null,
      };

      if (!processResult.ok) {
        result.wordpress.errors++;
        applicantInfo.action = 'error';
        applicantInfo.error = processResult.reason;
      } else if (processResult.skipped) {
        result.wordpress.skipped++;
        applicantInfo.action = 'skipped';
        applicantInfo.skipReason = processResult.reason;
      } else if (processResult.action === 'created') {
        result.wordpress.created++;
        applicantInfo.action = 'created';
        applicantInfo.postId = processResult.postId;
      } else if (processResult.action === 'updated') {
        result.wordpress.updated++;
        applicantInfo.action = 'updated';
        applicantInfo.postId = processResult.postId;
      } else if (processResult.action === 'unchanged') {
        result.wordpress.unchanged++;
        applicantInfo.action = 'unchanged';
        applicantInfo.postId = processResult.postId;
      }

      result.applicants.push(applicantInfo);

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    }

    // Count spray academy + passed
    result.registrations.sprayAcademy = result.applicants.filter(
      (a) => a.courseCode === (process.env.SPRAY_ACADEMY_CODE || 'SPRA1-OA-001')
    ).length;
    result.registrations.passed = result.applicants.filter(
      (a) => a.action !== 'skipped' || a.skipReason !== 'not_passed'
    ).length;

  } catch (err) {
    result.success = false;
    result.errors.push(`Unexpected error: ${err.message}`);
  }

  result.completedAt = new Date().toISOString();
  result.durationMs = Date.now() - startTime;

  // Summary log
  log('');
  log('========================================');
  log(`  Sync Complete${dryRun ? ' (DRY RUN)' : ''}`);
  log('========================================');
  log(`  Duration:   ${(result.durationMs / 1000).toFixed(1)}s`);
  log(`  Fetched:    ${result.registrations.fetched} registrations`);
  log(`  Created:    ${result.wordpress.created}`);
  log(`  Updated:    ${result.wordpress.updated}`);
  log(`  Unchanged:  ${result.wordpress.unchanged}`);
  log(`  Skipped:    ${result.wordpress.skipped}`);
  log(`  Errors:     ${result.wordpress.errors}`);
  log('========================================');

  return result;
}

module.exports = { runSync };
