import { describe, expect, it } from 'vitest';

import { readCloudClients } from './cloudClients.js';

/**
 * Where a provider's client values come from (ADR-0091 Decision 2). The values here are made up;
 * the owner's are never in a case, a log or a commit.
 */
describe('cloud client values', () => {
  it('reads each provider from the environment, and Google’s secret beside its id', () => {
    const clients = readCloudClients(
      { MONSTERA_MS_CLIENT_ID: 'ms-id', MONSTERA_GOOGLE_CLIENT_ID: 'g-id', MONSTERA_GOOGLE_CLIENT_SECRET: 'g-secret' },
      null,
    );
    expect(clients).toStrictEqual({
      onedrive: { clientId: 'ms-id' },
      'google-drive': { clientId: 'g-id', clientSecret: 'g-secret' },
    });
  });

  it('a provider with NO id is not configured, and a blank one is no id', () => {
    expect(readCloudClients({ MONSTERA_MS_CLIENT_ID: '   ' }, null)).toStrictEqual({ onedrive: null, 'google-drive': null });
  });

  it('a packaged build reads the same names from its file, and the environment still wins', () => {
    const packaged = { MONSTERA_MS_CLIENT_ID: 'from-file', MONSTERA_GOOGLE_CLIENT_ID: 'g-file' };
    const clients = readCloudClients({ MONSTERA_GOOGLE_CLIENT_ID: 'g-env' }, packaged);
    expect(clients.onedrive).toStrictEqual({ clientId: 'from-file' });
    expect(clients['google-drive']).toStrictEqual({ clientId: 'g-env' });
  });

  it('CONTROL: Microsoft never takes a secret, even where one is set under Google’s name', () => {
    const clients = readCloudClients({ MONSTERA_MS_CLIENT_ID: 'ms', MONSTERA_GOOGLE_CLIENT_SECRET: 'x' }, null);
    expect(clients.onedrive).toStrictEqual({ clientId: 'ms' });
  });
});
