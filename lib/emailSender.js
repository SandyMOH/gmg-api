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

// ===== HTML email template =====
function buildEmailHtml(firstName) {
  const green = '#8DC63F';
  const dark = '#1f2421';

  // Links pulled from .env so they can be filled in later
  const productLink = process.env.LINK_PRODUCT || '#';
  const videoFormLink = process.env.LINK_VIDEO_FORM || '#';
  const docIfu = process.env.LINK_DOC_IFU || '#';
  const docJobSheet = process.env.LINK_DOC_JOBSHEET || '#';
  const docCleaning = process.env.LINK_DOC_CLEANING || '#';
  const logoUrl = process.env.GMG_LOGO_URL || '';
  const headerImageUrl = process.env.EMAIL_HEADER_IMAGE_URL || '';


  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <title>Congratulations - GMG Spray Academy</title>
  <style>
    /* Stop Apple from turning text blue */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
    }
    
    /* Mobile-specific styles */
    @media only screen and (max-width: 600px) {
      .mobile-hide { 
        display: none !important; 
      }
      .mobile-stack { 
        display: block !important; 
        margin-bottom: 8px !important; 
      }
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
              <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 20px;">
                You've successfully passed your GMG Spray Academy exam. You're now
                on your way to becoming a certified THERMAL-XR&reg; applicator.
              </p>
              <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 24px;">
                Here are your next steps to complete your certification:
              </p>

              <!-- Step 1 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
                <tr>
                  <td style="background:#f8f8f8; border-left:4px solid ${green}; padding:16px 20px;">
                    <div style="color:${dark}; font-size:15px; font-weight:bold; margin-bottom:6px;">
                      Step 1 &mdash; Purchase THERMAL-XR&reg;
                    </div>
                    <div style="color:#555555; font-size:14px; line-height:1.5; margin-bottom:10px;">
                      Get your THERMAL-XR&reg; product to begin your practical application.
                    </div>
                    <a href="${productLink}" style="color:${green}; font-size:14px; font-weight:bold; text-decoration:none;">
                      Purchase THERMAL-XR&reg; &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Step 2 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
                <tr>
                  <td style="background:#f8f8f8; border-left:4px solid ${green}; padding:16px 20px;">
                    <div style="color:${dark}; font-size:15px; font-weight:bold; margin-bottom:6px;">
                      Step 2 &mdash; Submit Your Application Video
                    </div>
                    <div style="color:#555555; font-size:14px; line-height:1.5; margin-bottom:10px;">
                      Record a 30&ndash;60 second video showing your surface preparation,
                      cleaning, and spray application on a coil. Upload it using the form below.
                    </div>
                    <a href="${videoFormLink}" style="color:${green}; font-size:14px; font-weight:bold; text-decoration:none;">
                      Upload Your Video &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Step 3 -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#f8f8f8; border-left:4px solid ${green}; padding:16px 20px;">
                    <div style="color:${dark}; font-size:15px; font-weight:bold; margin-bottom:6px;">
                      Step 3 &mdash; Reference Documents
                    </div>
                    <div style="color:#555555; font-size:14px; line-height:1.5; margin-bottom:10px;">
                      Review these supporting documents before your application:
                    </div>
                    <div style="margin-bottom:6px;">
                      <a href="${docIfu}" style="color:${green}; font-size:14px; text-decoration:none;">
                        &bull; THERMAL-XR Spray Application Process
                      </a>
                    </div>
                    <div style="margin-bottom:6px;">
                      <a href="${docJobSheet}" style="color:${green}; font-size:14px; text-decoration:none;">
                        &bull; Job Sheet
                      </a>
                    </div>
                    <div>
                      <a href="${docCleaning}" style="color:${green}; font-size:14px; text-decoration:none;">
                        &bull; Cleaning Data Sheet
                      </a>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="color:#333333; font-size:15px; line-height:1.6; margin:0 0 8px;">
                Once we've reviewed your video submission, we'll issue your official
                certificate and add you to the GMG Certified Applicator directory.
              </p>
              <p style="color:#333333; font-size:15px; line-height:1.6; margin:24px 0 0;">
                Kind regards,<br>
                <strong>The Spray Academy Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${dark}; padding:24px 32px; text-align:center;">
              <div style="margin-bottom: 15px;">
                <img src="${logoUrl}" alt="GMG Spray Academy Logo" width="150" style="display: block; margin: 0 auto; border: 0;">
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

// Plain text fallback
function buildEmailText(firstName) {
  const productLink = process.env.LINK_PRODUCT || '[product link]';
  const videoFormLink = process.env.LINK_VIDEO_FORM || '[video form link]';
  const docIfu = process.env.LINK_DOC_IFU || '[IFU link]';
  const docJobSheet = process.env.LINK_DOC_JOBSHEET || '[job sheet link]';
  const docCleaning = process.env.LINK_DOC_CLEANING || '[cleaning data sheet link]';

  return `Congratulations, ${firstName}!

You've successfully passed your GMG Spray Academy exam. You're now on your way
to becoming a certified THERMAL-XR(R) applicator.

Here are your next steps to complete your certification:

STEP 1 - Purchase THERMAL-XR(R)
Get your THERMAL-XR(R) product to begin your practical application.
${productLink}

STEP 2 - Submit Your Application Video
Record a 30-60 second video showing your surface preparation, cleaning, and
spray application on a coil. Upload it using this form:
${videoFormLink}

STEP 3 - Reference Documents
- Instructions for Use (IFU): ${docIfu}
- Job Sheet: ${docJobSheet}
- Cleaning Data Sheet: ${docCleaning}

Once we've reviewed your video submission, we'll issue your official certificate
and add you to the GMG Certified Applicator directory.

Kind regards,
The Spray Academy Team

---
Graphene Manufacturing Group
5/848 Boundary Road, Richlands QLD 4077
Phone +61 7 3063 6638
www.thermal-xr.com | sales@graphenemg.com`;
}

/**
 * Send the congratulations email.
 *
 * @param {object} applicant - { firstName, lastName, email }
 * @returns {object} { sent, to, testMode, error }
 */
async function sendCongratulationsEmail(applicant) {
  const { firstName, lastName, email } = applicant;

  // Check SMTP is configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    log(`  [EMAIL] SMTP not configured - skipping email for ${email}`);
    return { sent: false, error: 'smtp_not_configured' };
  }

  // Test mode - redirect all emails to the test recipient
  const testMode = process.env.EMAIL_TEST_MODE === 'true';
  const realRecipient = email;
  const recipient = testMode
    ? process.env.EMAIL_TEST_RECIPIENT || process.env.SMTP_USER
    : email;

  if (!recipient) {
    log(`  [EMAIL] No recipient address for ${firstName} ${lastName}`);
    return { sent: false, error: 'no_recipient' };
  }

  const subjectPrefix = testMode ? '[TEST] ' : '';
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: recipient,
    subject: `${subjectPrefix}Congratulations on Passing Your GMG Spray Academy Exam`,
    text: buildEmailText(firstName),
    html: buildEmailHtml(firstName),
  };

  // In test mode, note who it would have gone to
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

module.exports = { sendCongratulationsEmail };
