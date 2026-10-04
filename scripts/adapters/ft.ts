import { LicenceRequiredError, type NewsSource } from './news';

/**
 * FT: licensed access only (Financial Times licensed content feed). This is a typed stub: no scraping, ever. It stays disabled unless
 * ENABLE_FT=true, and even then refuses until a licensed client is wired in here.
 */
export const ft: NewsSource = {
  name: 'ft',
  enabled: () => process.env.ENABLE_FT === 'true',
  async fetch() {
    throw new LicenceRequiredError(
      process.env.ENABLE_FT === 'true'
        ? 'FT: ENABLE_FT is set but no licensed client (Financial Times licensed content feed) is configured: licence required'
        : 'FT: licence required (disabled; set ENABLE_FT=true once a Financial Times licensed content feed is in place)',
    );
  },
};
