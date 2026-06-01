/**
 * processor.js
 *
 * The shared core logic for processing Spray Academy registrations.
 *
 * ROUTING:
 *   Pass + no certificate yet  → send congratulations email (no WP post)
 *   Has certificate            → add/update WP applicator post (no email)
 *   Fail                       → send fail email [placeholder] (no WP post)
 *   Other (in progress, etc.)  → skip
 */

const { log } = require('./logger');
const { sendCongratulationsEmail } = require('./emailSender');

const SPRAY_ACADEMY_CODE = process.env.SPRAY_ACADEMY_CODE || 'SPRA1-OA-001';

// ===== Helpers =====

function formatCertDate(isoDate) {
  if (!isoDate) return '';
  try {
    return new Date(isoDate).toISOString().split('T')[0];
  } catch {
    return isoDate;
  }
}

function deriveRegion(city, state) {
  if (city) return city.toUpperCase();
  if (state) return state.toUpperCase();
  return '';
}

function buildDisplayAddress(suburb, city, state, postCode) {
  return [suburb, city, state, postCode].filter(Boolean).join(', ');
}

function hasCertificate(data) {
  return data.certDate && data.certDate.trim() !== '';
}

function hasChanged(existingPost, incoming) {
  const acf = existingPost.acf || {};
  return (
    existingPost.title?.rendered !== incoming.title ||
    acf.email !== incoming.email ||
    acf.phone_number !== incoming.phone ||
    acf.company !== incoming.company ||
    acf.city !== incoming.city ||
    acf.state !== incoming.state ||
    acf.suburb !== incoming.suburb ||
    acf.post_code !== incoming.postCode
  );
}

// ===== Fail email placeholder =====
async function sendFailEmail(applicant) {
  // TODO: implement fail email template
  log(`  [EMAIL] FAIL email placeholder - would send to ${applicant.email}`);
  return { sent: false, reason: 'not_implemented_yet' };
}

/**
 * Process one applicator's data.
 *
 * @param {object} data    - extracted applicator data from Arlo
 * @param {object} deps    - { wp, geocoder }
 * @param {object} options - { dryRun, existingPosts, sendEmail }
 * @returns {object} result
 */
async function processApplicator(data, deps, options = {}) {
  const { wp, geocoder } = deps;
  const { dryRun = false, existingPosts = null, sendEmail = true } = options;

  if (!data) {
    return { ok: false, reason: 'no_data' };
  }

  const fullName = `${data.firstName} ${data.lastName}`.trim();

  // ===== FILTER: Spray Academy only =====
  if (data.courseCode !== SPRAY_ACADEMY_CODE) {
    log(`  SKIP ${fullName}: not Spray Academy (course: ${data.courseCode || 'none'})`);
    return { ok: true, skipped: true, reason: 'not_spray_academy' };
  }

  // ===== ROUTE based on outcome + certificate =====

  // CASE 1: FAIL → send fail email, do NOT add to WP
  if (data.outcome === 'Fail') {
    log(`  FAIL ${fullName}: outcome is Fail`);

    let emailResult = { sent: false, reason: 'disabled' };
    if (sendEmail && !dryRun) {
      emailResult = await sendFailEmail({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
      });
    } else if (dryRun) {
      log(`  [DRY RUN] Would send fail email to ${data.email}`);
    }

    return {
      ok: true,
      action: 'fail_email',
      name: fullName,
      email: data.email,
      emailResult,
    };
  }

  // CASE 2: PASS but NO certificate yet → send congrats email, do NOT add to WP
  if (data.outcome === 'Pass' && !hasCertificate(data)) {
    log(`  PASS (no cert yet) ${fullName}: sending congrats email only`);

    let emailResult = { sent: false, reason: 'disabled' };
    if (sendEmail && !dryRun) {
      emailResult = await sendCongratulationsEmail({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
      });
    } else if (dryRun) {
      log(`  [DRY RUN] Would send congrats email to ${data.email}`);
    }

    return {
      ok: true,
      action: 'congrats_email',
      name: fullName,
      email: data.email,
      emailResult,
    };
  }

  // CASE 3: HAS CERTIFICATE → add/update WP post, NO email
  if (hasCertificate(data)) {
    log(`  CERTIFIED ${fullName}: adding/updating WP directory`);

    // Build WP payload
    const displayAddress = buildDisplayAddress(data.suburb, data.city, data.state, data.postCode);

    const wpData = {
      title: fullName,
      arloRegistrationId: data.arloRegistrationId,
      licenseNumber: '',
      phone: data.phone,
      email: data.email,
      certDate: formatCertDate(data.certDate),
      company: data.company,
      region: deriveRegion(data.city, data.state),
      suburb: data.suburb,
      city: data.city,
      state: data.state,
      postCode: data.postCode,
      streetAddress: data.streetAddress,
      displayAddress,
      lat: null,
      lng: null,
    };

    // Geocode
    if (data.city || data.suburb) {
      const geo = await geocoder.geocode({
        street: data.streetAddress,
        suburb: data.suburb,
        city: data.city,
        state: data.state,
        postCode: data.postCode,
        country: data.country,
      });
      if (geo) {
        wpData.lat = geo.lat;
        wpData.lng = geo.lng;
        log(`  Geocoded ${fullName}: ${geo.lat}, ${geo.lng}`);
      } else {
        log(`  Could not geocode ${fullName}`);
      }
    }

    // Check if already in WP
    let existing;
    if (existingPosts) {
      existing = wp.findByArloId(existingPosts, data.arloRegistrationId);
    } else {
      existing = await wp.findByArloIdLive(data.arloRegistrationId);
    }

    // Create or update
    if (existing) {
      if (!hasChanged(existing, wpData)) {
        log(`  UNCHANGED ${fullName} (post #${existing.id})`);
        return { ok: true, action: 'unchanged', postId: existing.id };
      }

      if (dryRun) {
        log(`  [DRY RUN] Would UPDATE ${fullName} (post #${existing.id})`);
        return { ok: true, action: 'updated', postId: existing.id, dryRun: true };
      }

      try {
        await wp.updateApplicator(existing.id, wpData);
        log(`  UPDATED ${fullName} (post #${existing.id})`);
        return { ok: true, action: 'updated', postId: existing.id };
      } catch (err) {
        log(`  ERROR updating ${fullName}: ${err.message}`);
        return { ok: false, reason: 'wp_update_failed' };
      }
    } else {
      if (dryRun) {
        log(`  [DRY RUN] Would CREATE ${fullName}`);
        return { ok: true, action: 'created', dryRun: true };
      }

      try {
        const newPost = await wp.createApplicator(wpData);
        log(`  CREATED ${fullName} (post #${newPost.id})`);
        return { ok: true, action: 'created', postId: newPost.id };
      } catch (err) {
        log(`  ERROR creating ${fullName}: ${err.message}`);
        if (err.response) {
          log(`    Status ${err.response.status}: ${JSON.stringify(err.response.data).substring(0, 200)}`);
        }
        return { ok: false, reason: 'wp_create_failed' };
      }
    }
  }

  // CASE 4: No outcome yet (in progress, not graded) → skip
  log(`  SKIP ${fullName}: no actionable outcome (outcome: ${data.outcome || 'none'}, cert: ${data.certDate ? 'yes' : 'no'})`);
  return { ok: true, skipped: true, reason: 'no_actionable_outcome' };
}

module.exports = { processApplicator, hasCertificate };
