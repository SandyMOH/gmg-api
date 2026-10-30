/**
 * teamsAlert.js
 *
 * Posts pipeline error alerts to a Microsoft Teams channel as an Adaptive Card.
 * Works with a Teams Workflows webhook ("Post to a channel when a webhook request
 * is received") and the older Incoming Webhook connector.
 *
 * Disabled unless TEAMS_WEBHOOK_URL is set.
 */

const axios = require('axios');
const { log } = require('./logger');

// "[Spray Academy] Fetch Registration failed" — a trailing "Failed" in the step isn't doubled
function alertTitle(step) {
  return `[Spray Academy] ${step.replace(/\s*failed$/i, '')} failed`;
}

function buildCard(title, errorMessage, dataRows) {
  const body = [
    { type: 'TextBlock', text: title, size: 'Medium', weight: 'Bolder', color: 'Attention', wrap: true },
    { type: 'TextBlock', text: errorMessage, fontType: 'Monospace', wrap: true, spacing: 'Medium' },
  ];

  if (dataRows.length) {
    body.push({
      type: 'FactSet',
      spacing: 'Medium',
      separator: true,
      facts: dataRows.map(([label, value]) => ({ title: label, value: String(value) })),
    });
  }

  body.push({ type: 'TextBlock', text: `Time: ${new Date().toISOString()}`, size: 'Small', isSubtle: true, spacing: 'Medium' });

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          msteams: { width: 'Full' },
          body,
        },
      },
    ],
  };
}

// dataRows: [label, value] pairs, as built by emailSender's alertDataRows
async function sendTeamsAlert(step, errorMessage, dataRows = []) {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, buildCard(alertTitle(step), errorMessage, dataRows), { timeout: 10000 });
  } catch (err) {
    log(`  [ERROR ALERT] Failed to send Teams alert: ${err.response?.status ?? ''} ${err.message}`);
  }
}

module.exports = { sendTeamsAlert, alertTitle };
