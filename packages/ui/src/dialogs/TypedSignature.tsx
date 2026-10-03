import { Menu } from '@base-ui/react/menu';
import { useLingui } from '@lingui/react';
import { SIGNATURE_FONTS, type SignatureFont, type SignatureOutline } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

import {
  SIGNATURE_BLANK,
  SIGNATURE_CANNOT_WRITE,
  SIGNATURE_FACE_CANNOT_WRITE,
  SIGNATURE_FACES_LOADING,
  SIGNATURE_OUTLINE_TOO_LONG,
  SIGNATURE_PREVIEW,
  SIGNATURE_STYLE,
  SIGNATURE_STYLE_CHOSEN,
} from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import { Input } from '../primitives/Input.js';
import { type LoadedFace, type SetName, loadFaces, outlinePath, setName, signatureFaceName } from '../signatureFaces.js';

/**
 * A typed signature's fields, for both dialogs that make one — the plain *Signature* and *Sign with certificate*
 * (ADR-0150): the name across the dialog's width, the style chosen from a list that shows the name in every face, and
 * the name large, as it will be placed.
 *
 * **Everything shown is the outline the page receives** (`signatureFaces.ts`): the list, the preview and a kept
 * signature are drawn as paths from the same glyphs, so no CSS font stands in for the face.
 */

/** The fifteen faces, read once and then held; `undefined` while they are being read. */
export function useSignatureFaces(): readonly LoadedFace[] | undefined {
  const [faces, setFaces] = useState<readonly LoadedFace[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadFaces().then((loaded) => {
      if (live) setFaces(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  return faces;
}

/** `face`'s read form among `faces`. */
export function faceIn(faces: readonly LoadedFace[], face: SignatureFont): LoadedFace | undefined {
  return faces.find((each) => each.face === face);
}

/** `text` set in `face`, once per change; `undefined` while the faces are read or nothing is typed. */
export function useTypedName(faces: readonly LoadedFace[] | undefined, face: SignatureFont, text: string): SetName | undefined {
  return useMemo(() => {
    const loaded = faces === undefined ? undefined : faceIn(faces, face);
    return loaded === undefined || text === '' ? undefined : setName(loaded, text);
  }, [faces, face, text]);
}

/** The sentence for a name its face cannot set, or `undefined` when it sets. */
export function typedNameProblem(
  set: SetName,
): { readonly message: MessageKey; readonly values: Readonly<Record<string, string>> } | undefined {
  if (set.kind === 'missing') return { message: SIGNATURE_CANNOT_WRITE, values: { characters: set.characters.join(' ') } };
  if (set.kind === 'too-long') return { message: SIGNATURE_OUTLINE_TOO_LONG, values: {} };
  if (set.kind === 'blank') return { message: SIGNATURE_BLANK, values: {} };
  return undefined;
}

/**
 * An outline drawn as it will land: dark ink on the page's white, scaled to the box the caller gives it.
 *
 * @param label the accessible name; a decorative drawing beside its own words passes `undefined`
 */
export function SignatureOutlineImage({
  outline,
  label,
  className,
}: {
  readonly outline: SignatureOutline;
  readonly label: string | undefined;
  readonly className: string;
}): ReactElement {
  const { d, viewBox } = outlinePath(outline);
  return (
    <svg
      {...(label === undefined ? { 'aria-hidden': true } : { 'aria-label': label, role: 'img' })}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      viewBox={viewBox}
    >
      <path d={d} />
    </svg>
  );
}

/**
 * What a face draws for the list and the preview: the name, or — while nothing is typed, or when the face cannot set
 * what is — the face's own name, FAINT, so a sample is never an empty box. `name` is the name's own result, for the
 * note that says why.
 */
function shownIn(
  face: LoadedFace,
  text: string,
  fallback: string,
): { readonly name: SetName | undefined; readonly shown: SetName; readonly faint: boolean } {
  const name = text === '' ? undefined : setName(face, text);
  if (name?.kind === 'outline') return { name, shown: name, faint: false };
  return { name, shown: setName(face, fallback), faint: true };
}

/**
 * The style chosen from a menu whose every choice shows the name in that face.
 *
 * **A Base UI Menu, never its Select**, `ChoiceMenu`'s reason: Base UI's Select injects a `<style>` element, which the
 * renderer's pinned CSP refuses. Each choice is a radio item, so the chosen one is announced; its accessible name is the
 * face's name, and a face that cannot write the name says which characters beside it.
 */
function SignatureFaceMenu({
  faces,
  text,
  value,
  onChange,
}: {
  readonly faces: readonly LoadedFace[];
  readonly text: string;
  readonly value: SignatureFont;
  readonly onChange: (face: SignatureFont) => void;
}): ReactElement {
  const { _ } = useLingui();
  const samples = useMemo(
    () => faces.map((face) => ({ face: face.face, ...shownIn(face, text, _(signatureFaceName(face.face))) })),
    [faces, text, _],
  );
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={_(SIGNATURE_STYLE_CHOSEN, { face: _(signatureFaceName(value)) })}
        className="m-choice-menu m-signature-faces__trigger"
        data-signature-faces=""
      >
        <span className="m-choice-menu__name">{_(signatureFaceName(value))}</span>
        <Icon name="ChevronDown" size="dense" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom" sideOffset={4}>
          <Menu.Popup className="m-context-menu m-signature-faces">
            <Menu.RadioGroup
              value={value}
              onValueChange={(next: unknown) => {
                // A FACE FROM THE LIST ONLY: Base UI types a radio's value as `unknown`.
                const picked = SIGNATURE_FONTS.find((face) => face === next);
                if (picked !== undefined && picked !== value) onChange(picked);
              }}
            >
              <Menu.GroupLabel className="m-choice-menu__heading">{_(SIGNATURE_STYLE)}</Menu.GroupLabel>
              {samples.map(({ face, name, shown, faint }) => (
                <Menu.RadioItem
                  className="m-context-menu-item"
                  closeOnClick
                  data-signature-face={face}
                  key={face}
                  label={_(signatureFaceName(face))}
                  value={face}
                >
                  <Menu.RadioItemIndicator className="m-choice-menu__mark" keepMounted>
                    {face === value ? <Icon name="Check" size="dense" /> : null}
                  </Menu.RadioItemIndicator>
                  <span className="m-signature-faces__sample" data-faint={faint ? '' : undefined}>
                    {shown.kind === 'outline' ? (
                      <SignatureOutlineImage className="m-signature-faces__ink" label={undefined} outline={shown.outline} />
                    ) : null}
                  </span>
                  <span className="m-signature-faces__text">
                    <span>{_(signatureFaceName(face))}</span>
                    {name?.kind === 'missing' ? (
                      <span className="m-signature-faces__cannot">
                        {_(SIGNATURE_FACE_CANNOT_WRITE, { characters: name.characters.join(' ') })}
                      </span>
                    ) : null}
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The name, the style and the preview.
 *
 * @param set the name set in the chosen face, which the caller also needs to decide whether there is a mark; passed in
 *   rather than computed twice
 */
export function TypedSignatureFields({
  label,
  text,
  onTextChange,
  invalid,
  faces,
  face,
  onFaceChange,
}: {
  readonly label: MessageKey;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly invalid: boolean;
  readonly faces: readonly LoadedFace[] | undefined;
  readonly face: SignatureFont;
  readonly onFaceChange: (face: SignatureFont) => void;
}): ReactElement {
  const { _ } = useLingui();
  const chosen = faces === undefined ? undefined : faceIn(faces, face);
  const preview = chosen === undefined ? undefined : shownIn(chosen, text.trim(), _(signatureFaceName(face)));
  const outline = preview?.shown.kind === 'outline' ? preview.shown.outline : undefined;
  return (
    <div className="m-typed-signature">
      <Input invalid={invalid} label={label} onValueChange={onTextChange} opensFocused purpose="name" value={text} />
      <div className="m-typed-signature__style">
        <span className="m-dialog-row__label">{_(SIGNATURE_STYLE)}</span>
        {faces === undefined ? (
          <span className="m-dialog-row__note">{_(SIGNATURE_FACES_LOADING)}</span>
        ) : (
          <SignatureFaceMenu faces={faces} onChange={onFaceChange} text={text.trim()} value={face} />
        )}
      </div>
      {/* THE NAME AS IT WILL BE PLACED, large, on the page's white. While nothing is typed, or when the style cannot set
          what is, it shows the style's own name in faint ink, so the box is never an empty frame; the status line says
          why. Only the name itself is named as the signature. */}
      <div className="m-typed-signature__preview" data-signature-preview={preview?.faint === false ? 'name' : 'face'}>
        {outline === undefined ? null : (
          <SignatureOutlineImage
            className="m-typed-signature__ink"
            label={preview?.faint === false ? _(SIGNATURE_PREVIEW) : undefined}
            outline={outline}
          />
        )}
      </div>
    </div>
  );
}
