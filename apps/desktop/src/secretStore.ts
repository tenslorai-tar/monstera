import { createJsonFile, type SettingsSurface } from './settingsFile.js';

/**
 * Where a secret setting lives, and why it is not in `settings.json`.
 *
 * ## The rule this implements
 *
 * `BUILD-PROMPT.md` E5: an AI provider's key goes in **`safeStorage`**, with an
 * honest no-key state. Until 2026-09-10 nothing here used it — `safeStorage`
 * appeared nowhere under `packages/` or `apps/` — and `settings.save` carried
 * secret values into the plain settings document on purpose, its own note
 * saying so. Excluding them from **export** is a different operation, and §7
 * asks for both.
 *
 * ## A SEPARATE FILE, not a field in the settings document
 *
 * The settings file is rewritten whole on every change and read leniently on
 * every launch. Putting ciphertext inside it means every settings write
 * re-serialises the secrets, and a corrupt document takes the keys with it.
 * More importantly it leaves *is this value encrypted* a property of a key's
 * name rather than of the file it is in — and a rule keyed on a name is one the
 * next writer re-derives.
 *
 * Two files: one a person could paste into a support ticket, one they could
 * not.
 *
 * ## The encryptor is INJECTED, for `encodePng`'s reason
 *
 * `safeStorage` is Electron's, and `composition.ts` imports no Electron. So the
 * pair arrives as two functions and this module does the file work — which
 * leaves every decision here testable in milliseconds against a temporary
 * directory and a fake cipher.
 */

/** The file's name inside whatever directory it is given. */
export const SECRETS_FILE = 'secrets.json';

/**
 * A store that keeps secrets in memory and says it can.
 *
 * `createEphemeralSettings`' sibling and for its reason: a handler graph built
 * in a test needs a real surface rather than a stub that throws, and one that
 * reported `available: false` would put every case in this repository on the
 * refusing branch — which is the branch that never stores anything, so nothing
 * downstream of a write would ever be exercised.
 *
 * It encrypts nothing, and the name is what says so.
 */
export function createEphemeralSecrets(): SecretStoreSurface {
  const held = new Map<string, string>();
  return {
    available: () => true,
    read: () => Object.fromEntries(held),
    write: (id, value) => {
      if (value === '') held.delete(id);
      else held.set(id, value);
    },
  };
}

/**
 * What main needs in order to keep a secret, and nothing more.
 *
 * `available` is separate from the two operations because it answers a question
 * a person's screen asks — *can this machine keep a key for you* — before any
 * key exists to try. Deriving it from a failed `encrypt` would mean discovering
 * it at the moment somebody pressed save.
 */
export interface SecretCipher {
  /** Whether the OS credential store is usable in this session. */
  available(): boolean;
  /** Ciphertext for one value. Called only when {@link available} is true. */
  encrypt(value: string): Buffer;
  /** The value back. Throws where the ciphertext is not this machine's. */
  decrypt(cipher: Buffer): string;
}

/** What the handlers need. Two operations and a fact. */
export interface SecretStoreSurface {
  available(): boolean;
  /** Every stored secret, decrypted. `{}` where none is stored or none reads. */
  read(): Readonly<Record<string, string>>;
  /** Stores one, or removes it where the value is empty. */
  write(id: string, value: string): void;
}

/**
 * A secret store backed by one JSON file of base64 ciphertext.
 *
 * ## A VALUE THAT WILL NOT DECRYPT IS DROPPED, not reported
 *
 * `safeStorage`'s ciphertext is bound to the OS account. A file copied between
 * machines, or a keyring reset, produces blobs this session cannot read — and
 * there is nothing the person can do about it except set the key again, which
 * is exactly what *no stored secret* leads them to. Reporting it would be an
 * incident for a condition nobody caused.
 *
 * **Each value is dropped on its own**, not the whole file: one unreadable blob
 * beside three readable ones is three settings that still work.
 *
 * ## Writing with no cipher REFUSES rather than storing plaintext
 *
 * The refusal is the point of the module. A store that fell back to the plain
 * file when encryption was unavailable would put a key in `settings.json`
 * exactly on the machines least able to protect it.
 */
export function createSecretStore(
  directory: string,
  cipher: SecretCipher,
): SecretStoreSurface {
  const file: SettingsSurface = createJsonFile(directory, SECRETS_FILE);

  return {
    available: () => cipher.available(),

    read() {
      if (!cipher.available()) return {};
      /** @type {Record<string, string>} */
      const out: Record<string, string> = {};
      for (const [id, stored] of Object.entries(file.read())) {
        if (typeof stored !== 'string') continue;
        try {
          out[id] = cipher.decrypt(Buffer.from(stored, 'base64'));
        } catch {
          // DROPPED, per the header. A blob from another machine is not an
          // error anybody can act on, and the empty state is the honest one.
          continue;
        }
      }
      return out;
    },

    write(id, value) {
      if (!cipher.available()) {
        throw new Error(
          'this machine has no usable credential store, so the value was not written — ' +
            'storing it in the settings file instead is what this module exists to prevent',
        );
      }
      const stored = { ...file.read() };
      // AN EMPTY VALUE REMOVES IT, which is what clearing the box means. A
      // stored empty string would read back as *a key is set* on the next
      // launch, and the surface would show a filled field with nothing in it.
      if (value === '') Reflect.deleteProperty(stored, id);
      else stored[id] = cipher.encrypt(value).toString('base64');
      file.write(stored);
    },
  };
}
