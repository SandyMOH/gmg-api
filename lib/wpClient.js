const axios = require('axios');

class WpClient {
  constructor(config) {
    this.baseUrl = config.url;
    this.auth = Buffer.from(`${config.user}:${config.appPassword}`).toString('base64');
    this.apiBase = `${this.baseUrl}/wp-json/wp/v2`;
  }

  async request(method, path, data = null) {
    const config = {
      method,
      url: `${this.apiBase}${path}`,
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/json',
      },
    };
    if (data) config.data = data;
    const response = await axios(config);
    return response.data;
  }

  // Get all applicator posts (handles pagination)
  async getAllApplicators() {
    let allPosts = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const posts = await this.request('GET', `/applicator?per_page=100&page=${page}`);
        allPosts = allPosts.concat(posts);
        page++;
        if (posts.length < 100) hasMore = false;
      } catch (err) {
        if (err.response?.status === 400) {
          hasMore = false; // no more pages
        } else {
          throw err;
        }
      }
    }

    return allPosts;
  }

  // Find an existing applicator by Arlo registration ID (from a given list)
  findByArloId(posts, arloRegId) {
    return posts.find((post) => {
      const acf = post.acf || {};
      return String(acf.arlo_registration_id) === String(arloRegId);
    });
  }

  // Find an existing applicator by Arlo registration ID (fetches from WP)
  async findByArloIdLive(arloRegId) {
    const all = await this.getAllApplicators();
    return this.findByArloId(all, arloRegId);
  }

  // Build the ACF payload from applicator data
  buildAcf(data) {
    const acf = {
      arlo_registration_id: data.arloRegistrationId,
      license_number: data.licenseNumber || '',
      phone_number: data.phone || '',
      email: data.email || '',
      certification_date: data.certDate || '',
      company: data.company || '',
      suburb: data.suburb || '',
      city: data.city || '',
      state: data.state || '',
      country: data.country || '',
      post_code: data.postCode || '',
      street_address: data.streetAddress || '',
      address: data.displayAddress || '',
    };

    if (data.lat && data.lng) {
      acf.location = {
        address: data.gmapLocation || '',
        lat: data.lat,
        lng: data.lng,
      };
    }

    return acf;
  }

  // Create a new applicator post
  async createApplicator(data) {
    return await this.request('POST', '/applicator', {
      title: data.title,
      status: 'publish',
      acf: this.buildAcf(data),
    });
  }

  // Update an existing applicator post
  async updateApplicator(postId, data) {
    return await this.request('PUT', `/applicator/${postId}`, {
      title: data.title,
      acf: this.buildAcf(data),
    });
  }
}

module.exports = WpClient;
