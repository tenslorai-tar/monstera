import { describe, expect, it } from 'vitest';

import { SERVICE_DOMAINS, hostWithin, onOrigin, serviceOrigin } from './serviceAddress.js';

describe('serviceOrigin', () => {
  it('answers the origin of each documented host form, path and default port dropped', () => {
    expect(serviceOrigin('azure-openai', 'https://mine.openai.azure.com/')).toBe('https://mine.openai.azure.com');
    expect(serviceOrigin('azure-openai', 'https://mine.services.ai.azure.com/openai/v1/')).toBe('https://mine.services.ai.azure.com');
    expect(serviceOrigin('azure-openai', 'https://Mine.OpenAI.Azure.US:443')).toBe('https://mine.openai.azure.us');
    expect(serviceOrigin('azure-document-intelligence', 'https://mine.cognitiveservices.azure.com')).toBe(
      'https://mine.cognitiveservices.azure.com',
    );
    expect(serviceOrigin('azure-document-intelligence', 'https://westeurope.api.cognitive.microsoft.com/')).toBe(
      'https://westeurope.api.cognitive.microsoft.com',
    );
  });

  it('refuses every address that would send the key somewhere else, or carry something else', () => {
    for (const typed of [
      '',
      'mine.openai.azure.com',
      'http://mine.openai.azure.com',
      'file:///C:/key.txt',
      'https://example.test',
      'https://evilopenai.azure.com',
      'https://mine.openai.azure.com.example.test',
      'https://mine.openai.azure.com.',
      'https://mine.openai.azure.com:8443',
      'https://user@mine.openai.azure.com',
      'https://user:pass@mine.openai.azure.com',
      'https://127.0.0.1',
      'https://[::1]',
    ]) {
      expect({ typed, origin: serviceOrigin('azure-openai', typed) }).toStrictEqual({ typed, origin: null });
    }
  });

  it('keeps each service to its own hosts: one service’s address is not the other’s', () => {
    expect(serviceOrigin('azure-openai', 'https://mine.cognitiveservices.azure.com')).toBeNull();
    expect(serviceOrigin('azure-document-intelligence', 'https://mine.openai.azure.com')).toBeNull();
  });

  it('CONTROL: every declared domain answers a resource under it, so no entry is dead', () => {
    for (const [service, domains] of Object.entries(SERVICE_DOMAINS) as [keyof typeof SERVICE_DOMAINS, readonly string[]][]) {
      for (const domain of domains) expect(serviceOrigin(service, `https://mine.${domain}`)).toBe(`https://mine.${domain}`);
    }
  });
});

describe('hostWithin', () => {
  it('is the domain or a name under it, the dot load-bearing, in any case', () => {
    expect(hostWithin('docusign.net', 'docusign.net')).toBe(true);
    expect(hostWithin('NA3.DocuSign.net', 'docusign.net')).toBe(true);
    expect(hostWithin('evil-docusign.net', 'docusign.net')).toBe(false);
    expect(hostWithin('docusign.net.example.test', 'docusign.net')).toBe(false);
  });
});

describe('onOrigin', () => {
  it('is the same scheme, host and port, and nothing that does not parse', () => {
    const origin = 'https://mine.cognitiveservices.azure.com';
    expect(onOrigin(`${origin}/documentintelligence/analyzeResults/1`, origin)).toBe(true);
    expect(onOrigin('https://example.test/analyzeResults/1', origin)).toBe(false);
    expect(onOrigin('http://mine.cognitiveservices.azure.com/analyzeResults/1', origin)).toBe(false);
    expect(onOrigin(`${origin}:8443/analyzeResults/1`, origin)).toBe(false);
    expect(onOrigin('not a url', origin)).toBe(false);
  });
});
