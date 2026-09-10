import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SECRETS_FILE, type SecretCipher, createSecretStore } from './secretStore.js';
import { SETTINGS_FILE, createSettingsFile } from './settingsFile.js';

/**
 * A secret setting's storage, against a real directory and a fake cipher.
 *
 * ## The cipher is fake and the FILE is real, which is the split that matters
 *
 * What `safeStorage` does with a string is Electron's business and is not
 * testable in milliseconds. What this module does — which document a value
 * lands in, what happens when the machine cannot encrypt, what an empty value
 * means — is entirely testable, and every one of those decisions is where the
 * defect would be.
 *
 * The fake is REVERSIBLE AND VISIBLE: it reverses the string. So a case can
 * assert both that the stored bytes are not the plaintext and that the value
 * comes back, which a fake that returned its input could not.
 */

/**
 * A cipher whose ciphertext is obviously not its plaintext.
 *
 * XOR rather than a string reversal: spreading a string decomposes emoji and
 * breaks rich characters, which the lint rule says and which would matter here
 * — a key is an arbitrary string and this fake has to survive one. XOR over
 * BYTES is its own inverse and touches no code point.
 */
function reversingCipher(available = true): SecretCipher {
  const flip = (bytes: Buffer): Buffer => Buffer.from(bytes.map((byte) => byte ^ 0x5a));
  return {
    available: () => available,
    encrypt: (value) => flip(Buffer.from(value, 'utf8')),
    decrypt: (cipher) => flip(cipher).toString('utf8'),
  };
}

const directories: string[] = [];
function workspace(): string {
  const made = mkdtempSync(join(tmpdir(), 'monstera-secret-store-'));
  directories.push(made);
  return made;
}

afterEach(() => {
  for (const made of directories.splice(0)) rmSync(made, { recursive: true, force: true });
});

describe('the secret store', () => {
  it('keeps a secret OUT of the settings file, which is the whole point', () => {
    const directory = workspace();
    const settings = createSettingsFile(directory);
    const secrets = createSecretStore(directory, reversingCipher());

    settings.write({ 'viewing.zoom': 1.25 });
    secrets.write('ai.azure.key', 'sk-not-a-real-key');

    // THE PAIR, and neither half alone says anything. The first asserts the
    // key is not in the document a person might paste into a support ticket;
    // the second that the settings file is still a real file with the ordinary
    // setting in it — without which the first passes for a store that wrote
    // nothing anywhere.
    const settingsText = readFileSync(join(directory, SETTINGS_FILE), 'utf8');
    expect(settingsText).not.toContain('sk-not-a-real-key');
    expect(settingsText).toContain('viewing.zoom');

    expect(secrets.read()).toStrictEqual({ 'ai.azure.key': 'sk-not-a-real-key' });
  });

  it('stores CIPHERTEXT, not the value, and reads it back', () => {
    const directory = workspace();
    const secrets = createSecretStore(directory, reversingCipher());
    secrets.write('ai.azure.key', 'abcdef');

    const stored = readFileSync(join(directory, SECRETS_FILE), 'utf8');
    // ASSERTED IN BOTH DIRECTIONS. That the plaintext is absent is what a store
    // writing nothing also produces; that the round trip works is what a store
    // writing plaintext also produces. Only the two together separate this
    // module from either.
    expect(stored).not.toContain('abcdef');
    expect(secrets.read()['ai.azure.key']).toBe('abcdef');
  });

  it('REFUSES to write where the machine cannot encrypt', () => {
    const directory = workspace();
    const secrets = createSecretStore(directory, reversingCipher(false));

    expect(() => {
      secrets.write('ai.azure.key', 'sk-not-a-real-key');
    }).toThrow(/credential store/u);
    // AND NOTHING WAS WRITTEN. A refusal that had already created the file
    // would be the fallback this module exists to prevent, arriving as a
    // partial success.
    expect(existsSync(join(directory, SECRETS_FILE))).toBe(false);
  });

  it('reads as EMPTY where the machine cannot decrypt, rather than throwing', () => {
    const directory = workspace();
    createSecretStore(directory, reversingCipher()).write('ai.azure.key', 'abcdef');

    // A DIFFERENT MACHINE: same file, a cipher that cannot read it. This is a
    // copied profile or a reset keyring, and there is nothing the person can do
    // about it except set the key again — which the empty state leads them to.
    const elsewhere = createSecretStore(directory, {
      available: () => true,
      encrypt: (value) => Buffer.from(value, 'utf8'),
      decrypt: () => {
        throw new Error('not this machine');
      },
    });
    expect(elsewhere.read()).toStrictEqual({});
  });

  it('drops only the value it cannot read, not the whole file', () => {
    const directory = workspace();
    const secrets = createSecretStore(directory, {
      available: () => true,
      encrypt: (value) => Buffer.from(value, 'utf8'),
      // ONE VALUE IS UNREADABLE. Without this case, "reads as empty" above is
      // satisfied by a store that discards everything at the first failure,
      // which turns one stale blob into three lost settings.
      decrypt: (cipher) => {
        const text = cipher.toString('utf8');
        if (text === 'bad') throw new Error('not this machine');
        return text;
      },
    });
    secrets.write('ai.azure.key', 'good');
    secrets.write('ai.other.key', 'bad');

    expect(secrets.read()).toStrictEqual({ 'ai.azure.key': 'good' });
  });

  it('an EMPTY value removes the secret rather than storing an empty one', () => {
    const directory = workspace();
    const secrets = createSecretStore(directory, reversingCipher());
    secrets.write('ai.azure.key', 'abcdef');
    secrets.write('ai.azure.key', '');

    // A STORED EMPTY STRING WOULD READ BACK AS *a key is set*, and the surface
    // would show a filled field with nothing in it.
    expect(secrets.read()).toStrictEqual({});
  });

  it('answers nothing at all where encryption is unavailable, without touching the file', () => {
    const directory = workspace();
    createSecretStore(directory, reversingCipher()).write('ai.azure.key', 'abcdef');

    expect(createSecretStore(directory, reversingCipher(false)).read()).toStrictEqual({});
    // AND THE FILE SURVIVES. A keyring that is not ready yet is a temporary
    // state on Linux, and a read that cleared the store would lose the key
    // permanently on a machine that was about to be able to read it.
    expect(existsSync(join(directory, SECRETS_FILE))).toBe(true);
  });
});
