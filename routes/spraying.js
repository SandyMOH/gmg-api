const express = require('express');
const router = express.Router();
const { log } = require('../lib/logger');
const { wp } = require('../lib/clients');
const { sendErrorAlert } = require('../lib/emailSender');

router.post('/approve', async (req, res) => {
  const { arloRegistrationId, licenseNumber, name, email, company, reviewedAt } = req.body;

  if (!arloRegistrationId) {
    return res.status(400).json({ success: false, error: 'arloRegistrationId is required' });
  }

  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`APPROVE: ${name} (${email}) | arloId: ${arloRegistrationId}`);

  try {
    const certDate = (reviewedAt ?? new Date().toISOString()).split('T')[0];

    const wpData = {
      title: name || '',
      arloRegistrationId,
      licenseNumber: licenseNumber || '',
      email: email || '',
      company: company || '',
      certDate,
      status: 'certified',
      phone: '',
      suburb: '',
      city: '',
      state: '',
      postCode: '',
      streetAddress: '',
      displayAddress: '',
    };

    const existing = await wp.findByArloIdLive(arloRegistrationId);

    if (existing) {
      const acf = existing.acf || {};
      Object.assign(wpData, {
        phone: acf.phone_number || '',
        suburb: acf.suburb || '',
        city: acf.city || '',
        state: acf.state || '',
        postCode: acf.post_code || '',
        streetAddress: acf.street_address || '',
        displayAddress: acf.address || '',
        ...(acf.location?.lat && acf.location?.lng
          ? { lat: acf.location.lat, lng: acf.location.lng }
          : {}),
      });
      await wp.updateApplicator(existing.id, wpData);
      log(`  WP UPDATED ${name} (post #${existing.id}) → certified`);
    } else {
      const newPost = await wp.createApplicator(wpData);
      log(`  WP CREATED ${name} (post #${newPost.id}) → certified`);
    }

    log(`  ARLO: [PLACEHOLDER] Would trigger report for arloId ${arloRegistrationId}`);

    return res.json({ success: true });
  } catch (err) {
    log(`  APPROVE ERROR: ${err.message}`);
    await sendErrorAlert('Approve Application', err.message, { arloRegistrationId });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;