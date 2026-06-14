/**
 * emailSender.js
 *
 * Sends the Spray Academy congratulations email via Microsoft 365 SMTP.
 *
 * Test mode: when EMAIL_TEST_MODE=true, all emails go to EMAIL_TEST_RECIPIENT
 * instead of the real applicant - so you can check them safely.
 */

const nodemailer = require('nodemailer');
const { log } = require('./logger');

// ===== Build the SMTP transporter =====
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // STARTTLS - upgraded after connect
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  return transporter;
}

// ===== Shared HTML helpers =====

function buildStepCard(accentColor, { title, description, linksHtml = '', isLast = false }) {
  const dark = '#1f2421';
  const marginBottom = isLast ? '24px' : '18px';
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${marginBottom};">
    <tr>
      <td style="background:#f8f8f8; border-left:4px solid ${accentColor}; padding:16px 20px;">
        <div style="color:${dark}; font-size:15px; font-weight:bold; margin-bottom:6px;">
          ${title}
        </div>
        <div style="color:#555555; font-size:14px; line-height:1.5;${linksHtml ? ' margin-bottom:10px;' : ''}">
          ${description}
        </div>
        ${linksHtml}
      </td>
    </tr>
  </table>`;
}

function buildBaseEmailHtml({ title, bodyHtml }) {
  const dark = '#1f2421';
  const green = '#8DC63F';
  const logoUrl = process.env.GMG_LOGO_URL || '';
  const headerImageUrl = process.env.EMAIL_HEADER_IMAGE_URL || '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <title>${title}</title>
  <style>
    /* Stop Apple from turning text blue */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
    }
    @media only screen and (max-width: 600px) {
      .mobile-hide { display: none !important; }
      .mobile-stack { display: block !important; margin-bottom: 8px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f4f4f4; font-family:Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:8px; overflow:hidden;">

          <!-- Header -->
          ${headerImageUrl ? `
          <tr>
            <td style="background:${dark}; padding:20px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
                <tr>
                  <td width="55%" align="left" valign="middle">
                    <div style="color:#ffffff; font-size:22px; font-weight:bold; letter-spacing:0.5px;">
                      GMG SPRAY ACADEMY
                    </div>
                  </td>
                  <td width="45%" align="right" valign="middle">
                    <img src="${headerImageUrl}" alt="Apply THERMAL-XR Like a Pro" width="220" style="display:block; max-width:100%; height:auto; border:0;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : `
          <tr>
            <td style="background:${dark}; padding:28px 32px; text-align:center;">
              <div style="color:#ffffff; font-size:22px; font-weight:bold; letter-spacing:0.5px;">
                GMG SPRAY ACADEMY
              </div>
            </td>
          </tr>
          `}

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${dark}; padding:24px 32px; text-align:center;">
              <div style="margin-bottom: 15px;">
                <img src="${logoUrl}" alt="GMG Logo" width="150" style="display: block; margin: 0 auto; border: 0;">
              </div>
              <div style="color:#ffffff; font-size:14px; font-weight:bold; margin-bottom:6px;">
                Graphene Manufacturing Group
              </div>
              <div style="color:#aaaaaa; font-size:12px; line-height:1.6;">
                <a href="#" style="color:#aaaaaa; text-decoration:none; pointer-events:none;">
                  5/848 Boundary Road, Richlands QLD 4077
                </a><br>
                Phone +61 7 3063 6638<br>
                <a href="https://www.thermal-xr.com" class="mobile-stack" style="color:${green}; text-decoration:none;">www.thermal-xr.com</a>
                <span class="mobile-hide" style="color:#aaaaaa;">&nbsp;|&nbsp;</span>
                <a href="mailto:sales@graphenemg.com" class="mobile-stack" style="color:${green}; text-decoration:none;">sales@graphenemg.com</a>
              </div>
            </td>
          </tr>

        </table>

        <!-- Disclaimer -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:16px 32px; text-align:center;">
              <div style="color:#999999; font-size:11px;">
                You received this email because you completed the GMG Spray Academy course.
              </div>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ===== Pass email =====

function buildEmailHtml(fullName, uniqueCode) {
  const green = '#8DC63F';
  const productLink = process.env.LINK_PRODUCT || '#';
  const applyLink = uniqueCode ? `${process.env.FRONTEND_URL || 'http://localhost:3000'}/apply/${uniqueCode}` : '#';
  const docJobSheet = process.env.LINK_DOC_JOBSHEET || '#';
  const docCleaning = process.env.LINK_DOC_CLEANING || '#';

  const bodyHtml = `
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
      Congratulations, ${fullName}!
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
      You've successfully passed your GMG Spray Academy exam. You're now
      on your way to becoming a certified THERMAL-XR&reg; applicator.
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 24px;">
      Here are your next steps to complete your certification:
    </p>

    ${buildStepCard(green, {
      title: 'Step 1 &mdash; Purchase THERMAL-XR&reg;',
      description: 'Get your THERMAL-XR&reg; product so you&rsquo;re ready for your practical application.',
      linksHtml: `<a href="${productLink}" style="color:${green}; font-size:14px; font-weight:bold; text-decoration:none;">Purchase THERMAL-XR&reg; &rarr;</a>`,
    })}

    ${buildStepCard(green, {
      title: 'Step 2 &mdash; Submit Your Photo &amp; Video',
      description: 'Using your unique submission link, upload a <strong>photo</strong> of your finished spray application on a coil, and a <strong>30&ndash;60 second video</strong> showing your surface preparation, cleaning, and spray process.',
      linksHtml: `<a href="${applyLink}" style="color:${green}; font-size:14px; font-weight:bold; text-decoration:none;">Submit Your Application &rarr;</a>`,
    })}

    ${buildStepCard(green, {
      title: 'Step 3 &mdash; Reference Documents',
      description: 'Review these supporting documents before completing your application:',
      linksHtml: `
        <div style="margin-bottom:6px;"><a href="${docJobSheet}" style="color:${green}; font-size:14px; text-decoration:none;">&bull; Job Sheet</a></div>
        <div><a href="${docCleaning}" style="color:${green}; font-size:14px; text-decoration:none;">&bull; Cleaning Data Sheet</a></div>
      `,
      isLast: true,
    })}

    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 8px;">
      Once we&rsquo;ve reviewed your photo and video submission, we&rsquo;ll issue your official
      certificate and add you to the GMG Certified Applicator directory.
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:24px 0 0;">
      Kind regards,<br>
      <strong>The Spray Academy Team</strong>
    </p>`;

  return buildBaseEmailHtml({ title: 'Congratulations - GMG Spray Academy', bodyHtml });
}

function buildEmailText(fullName, uniqueCode) {
  const productLink = process.env.LINK_PRODUCT || '[product link]';
  const applyLink = uniqueCode ? `${process.env.FRONTEND_URL || 'http://localhost:3000'}/apply/${uniqueCode}` : '[application link]';
  const docJobSheet = process.env.LINK_DOC_JOBSHEET || '[job sheet link]';
  const docCleaning = process.env.LINK_DOC_CLEANING || '[cleaning data sheet link]';

  return `Congratulations, ${fullName}!

You've successfully passed your GMG Spray Academy exam. You're now on your way
to becoming a certified THERMAL-XR(R) applicator.

Here are your next steps to complete your certification:

STEP 1 - Purchase THERMAL-XR(R)
Get your THERMAL-XR(R) product so you're ready for your practical application.
${productLink}

STEP 2 - Submit Your Photo & Video
Using your unique submission link, upload a photo of your finished spray
application on a coil, and a 30-60 second video showing your surface
preparation, cleaning, and spray process.
${applyLink}

STEP 3 - Reference Documents
- Job Sheet: ${docJobSheet}
- Cleaning Data Sheet: ${docCleaning}

Once we've reviewed your photo and video submission, we'll issue your official
certificate and add you to the GMG Certified Applicator directory.

Kind regards,
The Spray Academy Team

---
Graphene Manufacturing Group
5/848 Boundary Road, Richlands QLD 4077
Phone +61 7 3063 6638
www.thermal-xr.com | sales@graphenemg.com`;
}

// ===== Fail email =====

function buildFailEmailHtml(name) {
  const red = '#C0392B';

  const bodyHtml = `
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
      Dear ${name},
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
      Thank you for completing the GMG Spray Academy exam. Unfortunately,
      you were not successful on this attempt.
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 24px;">
      As a result, you are unable to continue with the course at this time.
      To proceed, please contact our team directly &mdash; we're here to help you take the next step.
    </p>

    ${buildStepCard(red, {
      title: 'Contact Us to Continue',
      description: "Please reach out to our team so we can discuss your options and guide you on how to move forward.",
      linksHtml: `<a href="mailto:sales@graphenemg.com" style="color:${red}; font-size:14px; font-weight:bold; text-decoration:none;">Contact Us &rarr;</a>`,
      isLast: true,
    })}

    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 8px;">
      We appreciate your effort and look forward to supporting you.
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:24px 0 0;">
      Kind regards,<br>
      <strong>The Spray Academy Team</strong>
    </p>`;

  return buildBaseEmailHtml({ title: 'Exam Result - GMG Spray Academy', bodyHtml });
}

function buildFailEmailText(fullName) {
  return `Dear ${fullName},

Thank you for completing the GMG Spray Academy exam. Unfortunately, you were
not successful on this attempt.

As a result, you are unable to continue with the course at this time. To
proceed, please contact our team directly - we're here to help you take
the next step.

CONTACT US TO CONTINUE
Please reach out to our team so we can discuss your options and guide you
on how to move forward: sales@graphenemg.com

We appreciate your effort and look forward to supporting you.

Kind regards,
The Spray Academy Team

---
Graphene Manufacturing Group
5/848 Boundary Road, Richlands QLD 4077
Phone +61 7 3063 6638
www.thermal-xr.com | sales@graphenemg.com`;
}

// ===== Shared send logic =====

async function sendEmail({ name, email, subject, html, text }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    log(`  [EMAIL] SMTP not configured - skipping email for ${email}`);
    return { sent: false, error: 'smtp_not_configured' };
  }

  const realRecipient = email;
  const recipient = process.env.EMAIL_TEST_RECIPIENT;

  if (!recipient) {
    log(`  [EMAIL] No recipient address for ${name}`);
    return { sent: false, error: 'no_recipient' };
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: recipient,
    subject: testMode ? `[TEST] ${subject}` : subject,
    text,
    html,
  };

  if (testMode) {
    mailOptions.html = mailOptions.html.replace(
      '</body>',
      `<div style="max-width:600px;margin:8px auto;padding:12px;background:#fff3cd;color:#856404;font-size:12px;font-family:Arial;border-radius:6px;">
        <strong>TEST MODE</strong> - In production this would be sent to: ${realRecipient}
      </div></body>`
    );
    mailOptions.text = `*** TEST MODE - would normally send to: ${realRecipient} ***\n\n${mailOptions.text}`;
  }

  try {
    const info = await getTransporter().sendMail(mailOptions);
    log(`  [EMAIL] Sent to ${recipient}${testMode ? ` (TEST - real: ${realRecipient})` : ''} | id: ${info.messageId}`);
    return { sent: true, to: recipient, testMode, realRecipient, messageId: info.messageId };
  } catch (err) {
    log(`  [EMAIL] FAILED for ${recipient}: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ===== Reviewer notification email =====

function buildReviewerEmailHtml(submission, reviewUrl) {
  const green = '#8DC63F';

  const rows = [
    ['Name', submission.name || '—'],
    ['Email', submission.email || '—'],
    ['Phone', submission.phone_number || '—'],
    ['Company', submission.company || '—'],
    ['Address', [submission.address, submission.suburb, submission.city, submission.state, submission.post_code].filter(Boolean).join(', ') || '—'],
  ];

  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px; font-size:14px; color:#555555; white-space:nowrap; width:120px;">${label}</td>
      <td style="padding:8px 12px; font-size:14px; color:#1f2421; font-weight:bold;">${value}</td>
    </tr>`).join('');

  const bodyHtml = `
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
      A new application has been submitted and is ready for your review.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8; border-left:4px solid ${green}; margin-bottom:24px;">
      ${tableRows}
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="background:${green}; border-radius:4px;">
          <a href="${reviewUrl}" style="display:inline-block; padding:12px 28px; color:#ffffff; font-size:15px; font-weight:bold; text-decoration:none;">
            Review Application &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="color:#888888; font-size:13px; line-height:1.5; margin:0;">
      If the button above doesn't work, copy and paste this link:<br>
      <a href="${reviewUrl}" style="color:${green}; word-break:break-all;">${reviewUrl}</a>
    </p>`;

  return buildBaseEmailHtml({ title: 'New Application for Review – GMG Spray Academy', bodyHtml });
}

function buildReviewerEmailText(submission, reviewUrl) {
  const address = [submission.address, submission.suburb, submission.city, submission.state, submission.post_code].filter(Boolean).join(', ') || '—';
  return `A new application has been submitted and is ready for your review.

Name:    ${submission.name || '—'}
Email:   ${submission.email || '—'}
Phone:   ${submission.phone_number || '—'}
Company: ${submission.company || '—'}
Address: ${address}

Review the application here:
${reviewUrl}

---
Graphene Manufacturing Group
5/848 Boundary Road, Richlands QLD 4077
Phone +61 7 3063 6638
www.thermal-xr.com | sales@graphenemg.com`;
}

async function notifyReviewer(submission, token) {
  const reviewerEmail = process.env.REVIEWER_EMAIL;
  if (!reviewerEmail) {
    log('  [EMAIL] REVIEWER_EMAIL not set - skipping reviewer notification');
    return { sent: false, error: 'no_reviewer_email' };
  }

  const reviewUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/review/${submission.unique_code}?${token}`;

  return sendEmail({
    name: 'Reviewer',
    email: reviewerEmail,
    subject: `New Application for Review – ${submission.name || 'Applicant'}`,
    html: buildReviewerEmailHtml(submission, reviewUrl),
    text: buildReviewerEmailText(submission, reviewUrl),
  });
}

// ===== Reject email =====

function buildRejectEmailHtml(name, reviewerNotes, newApplyLink) {
  const green = '#8DC63F';

  let stepNum = 1;
  const notesCard = reviewerNotes
    ? buildStepCard(green, {
        title: `Step ${stepNum++} &mdash; Reviewer Feedback`,
        description: reviewerNotes.replace(/\n/g, '<br>'),
      })
    : '';

  const bodyHtml = `
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
      Dear ${name},
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
      Thank you for submitting your GMG Spray Academy application. We&rsquo;ve reviewed
      your submission and have some feedback to help you with your resubmission.
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 24px;">
      Here are your next steps to complete your certification:
    </p>

    ${notesCard}

    ${buildStepCard(green, {
      title: `Step ${stepNum} &mdash; Submit Your Photo &amp; Video`,
      description: 'Using your unique submission link, upload a <strong>photo</strong> of your finished spray application on a coil, and a <strong>30&ndash;60 second video</strong> showing your surface preparation, cleaning, and spray process.',
      linksHtml: `<a href="${newApplyLink}" style="color:${green}; font-size:14px; font-weight:bold; text-decoration:none;">Submit Your Application &rarr;</a>`,
      isLast: true,
    })}

    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 8px;">
      Once we&rsquo;ve reviewed your new submission, we&rsquo;ll be in touch with the next steps
      toward your certification.
    </p>
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:24px 0 0;">
      Kind regards,<br>
      <strong>The Spray Academy Team</strong>
    </p>`;

  return buildBaseEmailHtml({ title: 'Application Update – GMG Spray Academy', bodyHtml });
}

function buildRejectEmailText(name, reviewerNotes, newApplyLink) {
  let stepNum = 1;
  const notesSection = reviewerNotes
    ? `STEP ${stepNum++} - REVIEWER FEEDBACK\n${reviewerNotes}\n\n`
    : '';

  return `Dear ${name},

Thank you for submitting your GMG Spray Academy application. We've reviewed
your submission and have some feedback to help you with your resubmission.

Here are your next steps to complete your certification:

${notesSection}STEP ${stepNum} - SUBMIT YOUR PHOTO & VIDEO
Using your unique submission link, upload a photo of your finished spray
application on a coil, and a 30-60 second video showing your surface
preparation, cleaning, and spray process.
${newApplyLink}

Once we've reviewed your new submission, we'll be in touch with the next
steps toward your certification.

Kind regards,
The Spray Academy Team

---
Graphene Manufacturing Group
5/848 Boundary Road, Richlands QLD 4077
Phone +61 7 3063 6638
www.thermal-xr.com | sales@graphenemg.com`;
}

// ===== Error alert email =====

function buildErrorAlertHtml(step, errorMessage, applicant = null) {
  const red = '#C0392B';
  const dark = '#1f2421';

  const applicantRows = applicant
    ? [
        ['Name', applicant.name || '—'],
        ['Email', applicant.email || '—'],
        ['Company', applicant.company || '—'],
        ['Course', applicant.courseCode || '—'],
        ['Outcome', applicant.outcome || '—'],
        ['Arlo ID', applicant.arloRegistrationId || '—'],
      ]
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding:8px 12px; font-size:14px; color:#555555; white-space:nowrap; width:130px;">${label}</td>
          <td style="padding:8px 12px; font-size:14px; color:#1f2421; font-weight:bold;">${value}</td>
        </tr>`
        )
        .join('')
    : '';

  const bodyHtml = `
    <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
      An error occurred in the GMG Spray Academy pipeline that requires your attention.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#f8f8f8; border-left:4px solid ${red}; margin-bottom:24px; padding:16px 20px;">
      <tr>
        <td>
          <div style="color:${dark}; font-size:15px; font-weight:bold; margin-bottom:8px;">
            Step: ${step}
          </div>
          <div style="color:${red}; font-size:14px; font-family:monospace; white-space:pre-wrap; word-break:break-word;">
            ${errorMessage}
          </div>
        </td>
      </tr>
    </table>

    ${
      applicant
        ? `
    <p style="color:#333333; font-size:15px; font-weight:bold; margin:0 0 8px;">Applicant Data</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#f8f8f8; border-left:4px solid #888; margin-bottom:24px;">
      ${applicantRows}
    </table>`
        : ''
    }

    <p style="color:#888888; font-size:13px; margin:0;">
      Time: ${new Date().toISOString()}
    </p>`;

  return buildBaseEmailHtml({ title: 'Pipeline Error – GMG Spray Academy', bodyHtml });
}

async function sendErrorAlert(step, errorMessage, applicant = null) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    log(`  [ERROR ALERT] ADMIN_EMAIL not set — skipping alert for step: ${step}`);
    return;
  }

  const subject = `[ERROR] GMG Pipeline – ${step}`;
  const textLines = [
    `ERROR in step: ${step}`,
    `Message: ${errorMessage}`,
    '',
    ...(applicant
      ? [
          'Applicant:',
          `  Name:    ${applicant.name || '—'}`,
          `  Email:   ${applicant.email || '—'}`,
          `  Company: ${applicant.company || '—'}`,
          `  Course:  ${applicant.courseCode || '—'}`,
          `  Outcome: ${applicant.outcome || '—'}`,
          `  ArloID:  ${applicant.arloRegistrationId || '—'}`,
          '',
        ]
      : []),
    `Time: ${new Date().toISOString()}`,
  ];

  try {
    await sendEmail({
      name: 'Admin',
      email: adminEmail,
      subject,
      html: buildErrorAlertHtml(step, errorMessage, applicant),
      text: textLines.join('\n'),
    });
  } catch (err) {
    log(`  [ERROR ALERT] Failed to send alert email: ${err.message}`);
  }
}

// ===== Public API =====

async function sendCongratulationsEmail(applicant) {
  const { fullName, email, uniqueCode } = applicant;
  return sendEmail({
    name: fullName,
    email,
    subject: 'Congratulations on Passing Your GMG Spray Academy Exam',
    html: buildEmailHtml(fullName, uniqueCode),
    text: buildEmailText(fullName, uniqueCode),
  });
}

async function sendFailEmail(applicant) {
  const { fullName, email } = applicant;
  return sendEmail({
    name: fullName,
    email,
    subject: 'Your GMG Spray Academy Exam Result',
    html: buildFailEmailHtml(fullName),
    text: buildFailEmailText(fullName),
  });
}

async function sendRejectionEmail({ name, email, reviewerNotes, newApplyLink }) {
  return sendEmail({
    name,
    email,
    subject: 'Your GMG Spray Academy Application – Action Required',
    html: buildRejectEmailHtml(name, reviewerNotes, newApplyLink),
    text: buildRejectEmailText(name, reviewerNotes, newApplyLink),
  });
}

module.exports = { sendCongratulationsEmail, sendFailEmail, sendRejectionEmail, notifyReviewer, sendErrorAlert };
