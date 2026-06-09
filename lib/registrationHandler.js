const { log } = require('./logger');

const toTitleCase = (str) =>
  str ? str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : '';
const { arlo, wp, geocoder } = require('./clients');
const { processApplicator, hasCertificate } = require('./processor');
const { sendFailEmail,  sendCongratulationsEmail } = require('./emailSender');
const { createApplicant, createSubmission } = require('./db');

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
  // const result = await processApplicator(data, { wp, geocoder }, { dryRun: false });

  const result = await processApplicatorData(data);

  return {
    ...result,
    name: `${data.firstName} ${data.lastName}`.trim(),
    email: data.email,
    company: data.company,
    courseCode: data.courseCode,
    outcome: data.outcome,
  };
}

async function processApplicatorData(data) {
  const fullName = `${data.firstName} ${data.lastName}`.trim();
  const SPRAY_ACADEMY_CODE = process.env.SPRAY_ACADEMY_CODE.split(',') || ['SPRA1-OA-001'];

  if (data.outcome === 'Fail') {
    // if failed, we want to send a fail email
      log(`  FAIL ${fullName}: outcome is Fail`);
  
      let emailResult = { sent: false, reason: 'disabled' };
      try{
        emailResult = await sendFailEmail({
          fullName,
          email: data.email,
        });
      } catch (err) {
        log(`  ERROR sending fail email to ${data.email}: ${err.message}`);
        emailResult = { sent: false, reason: 'email_failed', error: err.message };
      }
  
      return {
        ok: true,
        action: 'fail_email',
        name: fullName,
        email: data.email,
        emailResult,
      };
    }

  if (data.outcome === 'Pass' && !hasCertificate(data)) {
    // if passed but no cert, we want to send a congrats email and save data to db
    // the data on the db will be save applicant and submissions
    
    log(`  PASS (no cert yet) ${fullName}: sending congrats email only`);

    let applicantId, submissionId, uniqueCode;
    try {
      applicantId = createApplicant({
        arloRegistrationId: data.arloRegistrationId,
        name: fullName,
        email: data.email,
        phoneNumber: data.phone,
        company: data.company,
        address: data.streetAddress,
        suburb: toTitleCase(data.suburb),
        city: toTitleCase(data.city),
        state: toTitleCase(data.state),
        postCode: data.postCode,
      });
      ({ id: submissionId, uniqueCode } = createSubmission(applicantId));
      log(`  Created applicant ${applicantId} and submission ${submissionId}`);
    } catch (dbErr) {
      log(`  ERROR creating applicant/submission: ${dbErr.message}`);
    }

    let emailResult = await sendCongratulationsEmail({
      fullName,
      uniqueCode,
      email: data.email,
    });


    return {
      ok: true,
      action: 'congrats_email',
      name: fullName,
      email: data.email,
      applicantId,
      submissionId,
      uniqueCode,
      emailResult,
    };
  } 

    return {
      ok: true,
      action: 'none',
      reason: 'no_action_taken',
    };

   

}

module.exports = { handleRegistration };