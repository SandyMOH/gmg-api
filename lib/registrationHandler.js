const { log } = require('./logger');
const { arlo, wp, geocoder } = require('./clients');
const { processApplicator } = require('./processor');

async function handleRegistration(registrationId) {
  log(`Processing registration ${registrationId}...`);

  let reg;
  try {
    reg = await arlo.fetchRegistration(registrationId);
  } catch (err) {
    log(`  ERROR fetching registration ${registrationId}: ${err.message}`);
    return { ok: false, reason: 'fetch_failed', error: err.message };
  }

  const data = arlo.extractApplicator(reg);
  if (!data) {
    log(`  No data extracted for registration ${registrationId}`);
    return { ok: false, reason: 'no_data' };
  }

  log(`  ${data.firstName} ${data.lastName} | ${data.courseCode} | outcome: ${data.outcome}`);

  // Process the application
  const result = await processApplicator(data, { wp, geocoder }, { dryRun: false });

  return {
    ...result,
    name: `${data.firstName} ${data.lastName}`.trim(),
    email: data.email,
    company: data.company,
    courseCode: data.courseCode,
    outcome: data.outcome,
  };
}

module.exports = { handleRegistration };