import { userInfo } from 'node:os';

import { MAX_ANNOTATION_AUTHOR } from '@monstera/contract';

/**
 * The signed-in Windows user's name, which an empty *Your name for comments* stands for (ADR-0103).
 *
 * `os.userInfo()` throws a `SystemError` when the account has no user name or home directory, which
 * Node documents for accounts that exist without one. That is an answer rather than a fault — *no
 * name is known* — so it is the empty string, the same as a person who cleared the setting: marks are
 * made with no author rather than the application refusing to annotate. Sliced to the contract's
 * bound, since the name is written into `/T` as it is.
 */
export function windowsUserName(read: () => { readonly username: string } = userInfo): string {
  try {
    return read().username.slice(0, MAX_ANNOTATION_AUTHOR);
  } catch (thrown) {
    if (thrown instanceof Error && 'code' in thrown) return '';
    throw thrown;
  }
}
