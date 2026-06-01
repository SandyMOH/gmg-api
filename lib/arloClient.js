const axios = require('axios');
const { parseString } = require('xml2js');

class ArloClient {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.platform = config.platform;
    this.refreshToken = config.refreshToken;
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.baseUrl = `https://${this.platform}.arlo.co`;
    this.apiBase = `${this.baseUrl}/api/2012-02-01/auth/resources`;
  }

  // Authenticate - uses direct access token if provided, else refresh token
  async authenticate() {
    // Direct access token mode (testing only)
    if (process.env.ARLO_ACCESS_TOKEN) {
      this.accessToken = process.env.ARLO_ACCESS_TOKEN;
      this.tokenExpiry = Date.now() + 50 * 60 * 1000; // assume ~50 min left
      return true;
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

      if (data.refresh_token) {
        this.refreshToken = data.refresh_token;
      }

      return true;
    } catch (err) {
      console.error('Arlo auth failed:', err.response?.data || err.message);
      return false;
    }
  }

  // Ensure we have a valid token before a request
  async ensureAuth() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
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
