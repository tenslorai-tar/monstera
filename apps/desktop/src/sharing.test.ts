import { describe, expect, it } from 'vitest';

import { DATA_REQUESTED_HANDLER_SIGNATURE, parameterisedInterfaceId, shareTitle } from './sharing.js';

describe('parameterisedInterfaceId', () => {
  // THE EXPECTED IDS ARE THE SDK'S, read 2026-09-17 from Windows SDK 10.0.26100's
  // `winrt/windows.foundation.collections.h`, `winrt/windows.storage.h` and
  // `winrt/windows.applicationmodel.datatransfer.h` — never computed by this function.
  it('reproduces IIterable<String>, whose argument is a base type', () => {
    expect(parameterisedInterfaceId('pinterface({faa585ea-6214-4217-afda-7f46de5869b3};string)')).toBe(
      'e2fcc7c1-3bfc-5a0b-b2b0-72e769d1cb7e',
    );
  });

  it('reproduces IIterable<IStorageItem>, whose argument is an interface', () => {
    expect(
      parameterisedInterfaceId(
        'pinterface({faa585ea-6214-4217-afda-7f46de5869b3};{4207a996-ca2f-42f7-bde8-8b10457a7f30})',
      ),
    ).toBe('bb8b8418-65d1-544b-b083-6d172f568c73');
  });

  it('reproduces the DataRequested handler the sheet asks the delegate for', () => {
    expect(parameterisedInterfaceId(DATA_REQUESTED_HANDLER_SIGNATURE)).toBe('ec6f9cc8-46d0-5e0e-b4d2-7d7773ae37a0');
  });

  it('CONTROL: one character of the signature changes the ID', () => {
    expect(parameterisedInterfaceId(DATA_REQUESTED_HANDLER_SIGNATURE.replace('DataTransferManager;', 'DataTransferManagex;'))).not.toBe(
      'ec6f9cc8-46d0-5e0e-b4d2-7d7773ae37a0',
    );
  });
});

describe('shareTitle', () => {
  it('is the file name without its extension', () => {
    expect(shareTitle('Quarterly report.pdf')).toBe('Quarterly report');
    expect(shareTitle('archive.v2.pdf')).toBe('archive.v2');
  });

  it('keeps a name that is only an extension, or has none', () => {
    expect(shareTitle('.pdf')).toBe('.pdf');
    expect(shareTitle('notes')).toBe('notes');
  });
});
