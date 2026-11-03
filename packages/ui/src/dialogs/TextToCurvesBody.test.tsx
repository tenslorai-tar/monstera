// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import CurvesResultBody from './CurvesResultBody.js';
import { InDialog as Wrapped } from './inDialog.js';
import TextToCurvesBody from './TextToCurvesBody.js';

afterEach(() => {
  cleanup();
});

const FIELDS = /form fields become part of the page/u;
const TAGS = /reading order and tags are removed/u;

describe('TextToCurvesBody — what the person reads before it runs (ADR-0282 Decision 3)', () => {
  it('says what the copy is and what its text can no longer do, and the fields and tags lines where there are some', () => {
    const answered: unknown[] = [];
    render(
      <Wrapped>
        <TextToCurvesBody fields={2} tags={5} resolve={(result) => answered.push(result)} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByText(/every letter is drawn as a shape/u)).toBeTruthy();
    expect(screen.getByText(/searched, selected, copied, edited or read aloud/u)).toBeTruthy();
    expect(screen.getByText(/Your document stays as it is/u)).toBeTruthy();
    expect(screen.getByText(FIELDS)).toBeTruthy();
    expect(screen.getByText(TAGS)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy…' }));
    expect(answered).toStrictEqual([{ confirmed: true }]);
  });

  it('CONTROL: a document with neither fields nor tags reads nothing about either', () => {
    render(
      <Wrapped>
        <TextToCurvesBody fields={0} tags={0} resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.queryByText(FIELDS)).toBeNull();
    expect(screen.queryByText(TAGS)).toBeNull();
    expect(screen.getByText(/every letter is drawn as a shape/u)).toBeTruthy();
  });
});

describe('CurvesResultBody — the copy, its size, and what it lost (Decisions 4 and 7)', () => {
  it('states both sizes and names each loss by kind and count', () => {
    render(
      <Wrapped>
        <CurvesResultBody
          bytes={3 * 1024 * 1024}
          before={2048}
          lost={[
            { kind: 'fields', before: 3, after: 0 },
            { kind: 'link-targets', before: 2, after: 1 },
          ]}
          compared
          fontsLeft={0}
          resolve={() => undefined}
          update={() => undefined}
        />
      </Wrapped>,
    );
    expect(screen.getByText(/The copy is 3 MB\. The document is 2 KB\./u)).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toStrictEqual([
      '0 of 3 form fields kept. What they showed is part of the page.',
      '1 of 2 links still go somewhere.',
    ]);
  });

  it('CONTROL: nothing lost says everything else was kept; an uncounted copy says it cannot say, never that nothing went', () => {
    render(
      <Wrapped>
        <CurvesResultBody bytes={10} before={10} lost={[]} compared fontsLeft={0} resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByText(/Everything else the document holds was kept/u)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    cleanup();

    render(
      <Wrapped>
        <CurvesResultBody bytes={10} before={10} lost={[]} compared={false} fontsLeft={2} resolve={() => undefined} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.queryByText(/Everything else the document holds was kept/u)).toBeNull();
    expect(screen.getByText(/could not count what the copy kept/u)).toBeTruthy();
    expect(screen.getByText(/2 fonts could not be turned into shapes/u)).toBeTruthy();
  });

  it('opens the copy only when asked', () => {
    const answered: unknown[] = [];
    render(
      <Wrapped>
        <CurvesResultBody bytes={10} before={10} lost={[]} compared fontsLeft={0} resolve={(result) => answered.push(result)} update={() => undefined} />
      </Wrapped>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open the copy' }));
    expect(answered).toStrictEqual([{ open: true }]);
  });
});
