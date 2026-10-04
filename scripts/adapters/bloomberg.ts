import { LicenceRequiredError, type NewsSource } from './news';

/**
 * Bloomberg: licensed access only (Bloomberg Data License or BLPAPI). This is a typed stub: no scraping, ever. It stays disabled unless
 * ENABLE_BLOOMBERG=true, and even then refuses until a licensed client is wired in here.
 */
export const bloomberg: NewsSource = {
  name: 'bloomberg',
  enabled: () => process.env.ENABLE_BLOOMBERG === 'true',
  async fetch() {
    throw new LicenceRequiredError(
      process.env.ENABLE_BLOOMBERG === 'true'
        ? 'Bloomberg: ENABLE_BLOOMBERG is set but no licensed client (Bloomberg Data License or BLPAPI) is configured: licence required'
        : 'Bloomberg: licence required (disabled; set ENABLE_BLOOMBERG=true once a Bloomberg Data License or BLPAPI is in place)',
    );
  },
};
