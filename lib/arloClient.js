const axios = require('axios');
const { parseString } = require('xml2js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const {sendErrorAlert} = require('./emailSender');
const db = require('./db');

class ArloClient {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.platform = config.platform;
    this.provider = 'arlo';
    
    this.bootstrapToken = config.refreshToken;
    
    this.refreshToken = null;
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.baseUrl = `https://${this.platform}.arlo.co`;
    this.apiBase = `${this.baseUrl}/api/2012-02-01/auth/resources`;
    
    this._initPromise = this._init();
    
    cron.schedule('0 2 1 * *', async () => {
      console.log('[CRON] Keeping Arlo refresh token alive...');
      try {
        await this.ensureAuth();
        console.log('[CRON] Token refreshed successfully');
      } catch (err) {
        console.error('[CRON] Token refresh failed:', err.message);
      }
    });
  }

  async _init() {
    try {
      const row = await db.getOAuthToken(this.provider);
      if (row) {
        this.refreshToken = row.refresh_token;
        const daysSinceRefresh = (Date.now() - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24);
        console.log(`Arlo refresh token last updated ${Math.floor(daysSinceRefresh)} days ago`);
        if (daysSinceRefresh > 25) {
          console.warn('⚠️  Arlo refresh token approaching 30-day expiry');
        }
      } else if (this.bootstrapToken) {
        console.log('No Arlo token in DB — bootstrapping from .env');
        this.refreshToken = this.bootstrapToken;
        await db.saveOAuthToken(this.provider, this.bootstrapToken);
      } else {
        console.error('🔴 No Arlo refresh token in DB or .env — bootstrap required');
      }
    } catch (err) {
      console.error('Could not load Arlo refresh token from DB:', err.message);
    }
  }

  async _saveRefreshToken(token) {
    try {
      await db.saveOAuthToken(this.provider, token);
    } catch (err) {
      console.error('Could not persist refresh token to DB:', err.message);
    }
  }

  async authenticate() {
    await this._initPromise; // ensure init finished
    
    if (!this.refreshToken) {
      console.error('🔴 No refresh token available');
      return false;
    }
    
    const tokenUrl = `${this.baseUrl}/oauth/connect/token`;
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    try {
      const { data } = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }).toString(),
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

      // Persist rotated refresh token immediately
      if (data.refresh_token && data.refresh_token !== this.refreshToken) {
        this.refreshToken = data.refresh_token;
        await this._saveRefreshToken(this.refreshToken);
      }

      return true;
    } catch (err) {
      console.error('Arlo auth failed:', err.response?.data || err.message);
      const errorData = err.response?.data;
      if (errorData?.error === 'invalid_grant') {
        console.error('🔴 Refresh token is dead. Re-bootstrap required:');
        console.error('   1. Open Postman → Get New Access Token → complete 2FA');
        console.error('   2. Copy refresh_token to oauth_tokens table OR .env');
        console.error('   3. Restart the server');
        sendErrorAlert(
          'Arlo Authentication Failed',
          'The Arlo refresh token is no longer valid. Please re-bootstrap the token via Postman and update the oauth_tokens table.'
        ).catch(() => {});
      }
      return false;
    }
  }

  async ensureAuth() {
    await this._initPromise;
    if (this.accessToken && Date.now() < this.tokenExpiry) return;
    
    // Reuse in-flight auth promise if one exists
    if (!this._authPromise) {
      this._authPromise = this.authenticate().finally(() => {
        this._authPromise = null;
      });
    }
    await this._authPromise;
  }

  // Authenticated GET request (returns raw XML string)
  async get(path) {
    await this.ensureAuth();
    const { data } = await axios.get(`${this.apiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/xml',
      },
    });
    return data;
  }

  // Parse XML string to JS object
  parseXml(xmlString) {
    return new Promise((resolve, reject) => {
      parseString(
        xmlString,
        { explicitArray: false, ignoreAttrs: false, mergeAttrs: false },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });
  }

  // Fetch all completed registrations (used by the bulk sync)
  async fetchCompletedRegistrations() {
    const path = `/registrations/?filter=Status%20eq%20'Completed'&expand=Registration,Registration/Contact,Registration/Contact/PostalAddress,Registration/Contact/Employment,Registration/Contact/Employment/Organisation,Registration/OnlineActivity`;

    const xmlData = await this.get(path);
    const parsed = await this.parseXml(xmlData);

    if (!parsed || !parsed.Registrations) return [];

    const links = parsed.Registrations.Link;
    if (!links) return [];

    const linkArray = Array.isArray(links) ? links : [links];
    const registrations = [];

    for (const link of linkArray) {
      if (link.Registration) registrations.push(link.Registration);
    }

    return registrations;
  }

  // Fetch a single registration with details (used by the webhook)
  // If the expand doesn't inline the data, follows the links to fetch separately
  async fetchRegistration(registrationId) {
    const path = `/registrations/${registrationId}/?expand=Registration,Registration/Contact,Registration/Contact/PostalAddress,Registration/Contact/Employment,Registration/Contact/Employment/Organisation,Registration/OnlineActivity`;

    const xmlData = await this.get(path);
    const parsed = await this.parseXml(xmlData);

    let reg = null;
    if (parsed.Link && parsed.Link.Registration) {
      reg = parsed.Link.Registration;
    } else if (parsed.Registration) {
      reg = parsed.Registration;
    }

    if (!reg) return null;

    // Check if the Contact/OnlineActivity data is inlined or just links
    // If just links (no nested data), fetch them separately
    const links = Array.isArray(reg.Link) ? reg.Link : [reg.Link];

    let hasInlineContact = false;
    let hasInlineOnlineActivity = false;

    for (const link of links) {
      if (!link || !link.$) continue;
      if (link.$.title === 'Contact' && link.Contact) hasInlineContact = true;
      if (link.$.title === 'OnlineActivity' && link.OnlineActivity) hasInlineOnlineActivity = true;
    }

    // Fetch Contact separately if not inlined
    if (!hasInlineContact) {
      const contactLink = links.find((l) => l && l.$ && l.$.title === 'Contact');
      if (contactLink && contactLink.$.href) {
        try {
          // Extract the contact path from the full URL
          const contactUrl = contactLink.$.href;
          const contactPath = contactUrl.replace(`${this.apiBase}`, '');
          const expandContact = `${contactPath}?expand=Contact/PostalAddress,Contact/Employment,Contact/Employment/Organisation`;
          const contactXml = await this.get(expandContact);
          const contactParsed = await this.parseXml(contactXml);

          // Attach the fetched contact data back to the link
          let contactData = null;
          if (contactParsed.Link && contactParsed.Link.Contact) {
            contactData = contactParsed.Link.Contact;
          } else if (contactParsed.Contact) {
            contactData = contactParsed.Contact;
          }

          if (contactData) {
            contactLink.Contact = contactData;

            // PostalAddress and Employment are often not inlined even with expand — fetch them separately
            const cLinks = Array.isArray(contactData.Link)
              ? contactData.Link
              : contactData.Link ? [contactData.Link] : [];

            for (const cl of cLinks) {
              if (!cl || !cl.$) continue;
              const clTitle = cl.$?.title || '';

              if (clTitle === 'PostalAddress' && !cl.Address && cl.$.href) {
                try {
                  const paPath = cl.$.href.replace(`${this.apiBase}`, '');
                  const paXml = await this.get(paPath);
                  const paParsed = await this.parseXml(paXml);
                  const addrData = paParsed?.Link?.Address || paParsed?.Address || null;
                  if (addrData) cl.Address = addrData;
                } catch (err) {
                  console.warn(`  Could not fetch postal address: ${err.message}`);
                }
              }

              if (clTitle === 'Employment' && !cl.ContactEmployment && cl.$.href) {
                try {
                  const empPath = cl.$.href.replace(`${this.apiBase}`, '');
                  const empXml = await this.get(empPath);
                  const empParsed = await this.parseXml(empXml);
                  const empData = empParsed?.ContactEmployment || null;

                  if (empData) {
                    // Organisation is not inlined — fetch it separately
                    const empDataLinks = Array.isArray(empData.Link) ? empData.Link : (empData.Link ? [empData.Link] : []);
                    const orgLink = empDataLinks.find((l) => l?.$?.title === 'Organisation');
                    if (orgLink && !orgLink.Organisation && orgLink.$.href) {
                      try {
                        const orgPath = orgLink.$.href.replace(`${this.apiBase}`, '');
                        const orgXml = await this.get(orgPath);
                        const orgParsed = await this.parseXml(orgXml);
                        const orgData = orgParsed?.Link?.Organisation || orgParsed?.Organisation || null;
                        if (orgData) orgLink.Organisation = orgData;
                      } catch (err) {
                        console.warn(`  Could not fetch organisation: ${err.message}`);
                      }
                    }
                    cl.ContactEmployment = empData;
                  }
                } catch (err) {
                  console.warn(`  Could not fetch employment: ${err.message}`);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`  Could not fetch contact: ${err.message}`);
        }
      }
    }

    // Fetch OnlineActivity separately if not inlined
    if (!hasInlineOnlineActivity) {
      const oaLink = links.find((l) => l && l.$ && l.$.title === 'OnlineActivity');
      if (oaLink && oaLink.$.href) {
        try {
          const oaUrl = oaLink.$.href;
          const oaPath = oaUrl.replace(`${this.apiBase}`, '');
          const oaXml = await this.get(oaPath);
          const oaParsed = await this.parseXml(oaXml);

          let oaData = null;
          if (oaParsed.Link && oaParsed.Link.OnlineActivity) {
            oaData = oaParsed.Link.OnlineActivity;
          } else if (oaParsed.OnlineActivity) {
            oaData = oaParsed.  OnlineActivity;
          }

          if (oaData) {
            oaLink.OnlineActivity = oaData;
          }
        } catch (err) {
          console.warn(`  Could not fetch online activity: ${err.message}`);
        }
      }
    }

    return reg;
  }

  // Extract clean applicator data from a registration object
  extractApplicator(reg) {
  if (!reg) return null;

  let contact = null;
  let onlineActivity = null;
  let postalAddress = null;
  let organisation = null;

  // Convert links safely to an array
  const links = Array.isArray(reg.Link) ? reg.Link : (reg.Link ? [reg.Link] : []);

  for (const link of links) {
    if (!link) continue;
    
    // Check both standard property title or xml2js attribute object ($)
    const title = link.title || link.$?.title || '';

    // 1. EXTRACT CONTACT
    if (title === 'Contact' && link.Contact) {
      contact = link.Contact;
      
      const contactLinks = Array.isArray(contact.Link) ? contact.Link : (contact.Link ? [contact.Link] : []);
      for (const cl of contactLinks) {
        if (!cl) continue;
        const clTitle = cl.title || cl.$?.title || '';

        // Extract Postal Address
        if (clTitle === 'PostalAddress' && cl.Address) {
          postalAddress = cl.Address;
        }

        // Extract Employment -> Organisation
        if (clTitle === 'Employment' && cl.ContactEmployment) {
          // OrganisationName is often a direct field on ContactEmployment
          if (cl.ContactEmployment.OrganisationName) {
            organisation = { Name: cl.ContactEmployment.OrganisationName };
          }

          // Also check for a fully-expanded nested Organisation link
          const empLinks = Array.isArray(cl.ContactEmployment.Link)
            ? cl.ContactEmployment.Link
            : (cl.ContactEmployment.Link ? [cl.ContactEmployment.Link] : []);

          for (const el of empLinks) {
            if (!el) continue;
            const elTitle = el.title || el.$?.title || '';

            if (elTitle === 'Organisation' && el.Organisation) {
              organisation = el.Organisation;
            }
          }
        }
      }
    }

    // 2. EXTRACT ONLINE ACTIVITY
    if (title === 'OnlineActivity' && link.OnlineActivity) {
      onlineActivity = link.OnlineActivity;
    }
  }

  if (!contact) return null;

  return {
    arloRegistrationId: reg.RegistrationID || '',
    outcome: reg.Outcome || '',
    status: reg.Status || '',
    certDate: reg.CertificateSentDateTime || '',
    courseCode: onlineActivity ? onlineActivity.Code || '' : '',
    courseName: onlineActivity ? onlineActivity.Name || '' : '',
    firstName: contact.FirstName || '',
    lastName: contact.LastName || '',
    email: contact.Email || '',
    phone: contact.PhoneMobile || contact.PhoneWork || contact.PhoneHome || '',
    company: organisation ? (organisation.Name || '') : '', // Guaranteed to map now
    streetAddress: postalAddress ? postalAddress.StreetLine1 || '' : '',
    suburb: postalAddress ? postalAddress.SuburbOrRegion || '' : '',
    city: postalAddress ? postalAddress.City || '' : '',
    state: postalAddress ? postalAddress.StateOrProvince || '' : '',
    postCode: postalAddress ? postalAddress.PostCode || '' : '',
    country: postalAddress ? postalAddress.Country || '' : '',
  };
}
}

module.exports = ArloClient;
