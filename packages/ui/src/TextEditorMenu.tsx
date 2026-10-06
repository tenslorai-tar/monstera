import { ContextMenu } from '@base-ui/react/context-menu';
import { useLingui } from '@lingui/react';
import type { WindowEditAction } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, type ReactNode, type RefObject, useRef, useState } from 'react';

import {
  EDIT_COPY_TITLE,
  EDIT_CUT_TITLE,
  EDIT_PASTE_TITLE,
  EDIT_SELECT_ALL_TITLE,
  TEXT_MENU_ADD_WORD,
  TEXT_MENU_LABEL,
  TEXT_MENU_NO_SUGGESTIONS,
} from './messages/en.js';
import type { Lookup } from './spelling/personalWords.js';
import { replaceRange, wordAt } from './textFormatting.js';

/**
 * The in-place editor's right-click menu: what a word processor's offers over a word and over a selection
 * ([ADR-0180](../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)
 * Decision 8).
 *
 * ## It is the editor's own, and not a projection of the command registry
 *
 * The registry's context menus list COMMANDS, and this one's first section is VALUES: the replacements for the word
 * under the pointer, which exist only for that word. A command per replacement would register a thing that is a
 * different command at every right-click. So, like the status bar's zoom and the editor's own bar (ADR-0067), the part
 * that takes a value is the editor's; its clipboard verbs are the Edit menu's own, run through the one `native` call
 * (`window.edit`), so a Paste here is the Paste there.
 *
 * ## The page's own menu does not open over it
 *
 * A right-click on the words is about the words. The event is stopped above the menu, so the page's menu (rotate,
 * delete) is not opened beside it.
 *
 * ## Focus stays with the words
 *
 * The popup takes focus as any menu does, and the editor writes when it loses it, so the editor is told when the menu is
 * open (`onOpenChange`) and does not, and the popup returns the focus to the words when it closes (`finalFocus`). The
 * selection the menu was opened over is put back before a verb runs, since a verb acts on the selection.
 */
export interface EditorSpelling {
  /** Whether the checker has an opinion of a word, and its replacements; `undefined` where it has none. */
  readonly look: (word: string) => Promise<Lookup | undefined>;
  /** Keeps a word in the personal dictionary; the sentence of a refusal, `undefined` where it was kept. */
  readonly keep: (word: string) => MessageKey | undefined;
}

/** What the menu holds for the right-click it was opened by. */
interface Shown {
  /** The word under the pointer, and the words it spans, where the pointer was over one. */
  readonly word?: string;
  readonly range?: Range;
  /** The replacements for it where it is misspelt; `undefined` while asked, or where it is not. */
  readonly look?: Lookup;
  /** Whether something was selected in the words, which Cut and Copy need. */
  readonly selected: boolean;
  /** The selection the menu was opened over, put back before a verb runs. */
  readonly saved: Range | undefined;
}

export function TextEditorMenu({
  root,
  spell,
  native,
  onOpenChange,
  onNotice,
  children,
}: {
  /** The editor's element: where a right-click is about the words, and where the focus returns. */
  readonly root: RefObject<HTMLDivElement | null>;
  readonly spell?: EditorSpelling | undefined;
  /** The browser's own verb on the window — `window.edit`. */
  readonly native?: ((action: WindowEditAction) => void) | undefined;
  /** Told when the menu opens and closes, so the editor does not write while the focus is in it. */
  readonly onOpenChange: (open: boolean) => void;
  /** Says a sentence beside the words: the dictionary's refusal of a word. */
  readonly onNotice: (notice: MessageKey) => void;
  readonly children: ReactNode;
}): ReactElement {
  const { _ } = useLingui();
  const [shown, setShown] = useState<Shown | undefined>(undefined);
  const [open, setOpen] = useState(false);
  // WHETHER THE EVENT IN FLIGHT WAS OVER THE WORDS: set by the capture handler and read by `onOpenChange`, which Base UI
  // calls from the same event. A ref, because the state set a moment earlier is not readable until the next render.
  const asked = useRef(false);
  /** Numbers each right-click, so a lookup that returns after the menu was opened again writes nothing. */
  const serial = useRef(0);

  /** Puts the focus and the selection back in the words: a verb acts on what is selected, where it is focused. */
  const restore = (): void => {
    const element = root.current;
    if (element === null) return;
    element.focus();
    const range = shown?.saved;
    if (range === undefined) return;
    const selection = element.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };
  const run = (action: WindowEditAction): void => {
    restore();
    native?.(action);
  };

  return (
    // THE EVENT STOPS HERE (`onContextMenu` on the wrapper, after the trigger has seen it), so the page's menu is not opened.
    <div
      className="m-context-menu-region"
      onContextMenu={(event) => {
        if (asked.current) event.stopPropagation();
      }}
    >
      <ContextMenu.Root
        onOpenChange={(next) => {
          const now = next && asked.current;
          setOpen(now);
          onOpenChange(now);
        }}
        open={open}
      >
        <ContextMenu.Trigger
          className="m-context-menu-region"
          onContextMenuCapture={(event) => {
            const element = root.current;
            asked.current = element !== null && event.target instanceof Node && element.contains(event.target);
            if (!asked.current || element === null) return;
            const owner = element.ownerDocument;
            const selection = owner.getSelection();
            // THE WORD UNDER THE POINTER, by the browser's own answer to *which character is here*; an engine without it
            // falls back to where the caret is, which is where a right-click on a word leaves it where the platform moves it.
            const caret = (owner as Partial<Document>).caretPositionFromPoint?.call(owner, event.clientX, event.clientY);
            const at =
              caret !== null && caret !== undefined
                ? { node: caret.offsetNode, offset: caret.offset }
                : selection?.anchorNode == null
                  ? undefined
                  : { node: selection.anchorNode, offset: selection.anchorOffset };
            const found = at === undefined ? undefined : wordAt(element, at.node, at.offset);
            const selected = selection !== null && !selection.isCollapsed && element.contains(selection.anchorNode);
            serial.current += 1;
            const mine = serial.current;
            setShown({
              selected,
              saved: selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : undefined,
              ...(found === undefined ? {} : { word: found.word, range: found.range }),
            });
            if (found !== undefined && spell !== undefined) {
              void spell.look(found.word).then((answer) => {
                if (serial.current === mine && answer !== undefined) setShown((now) => (now === undefined ? now : { ...now, look: answer }));
              });
            }
          }}
        >
          {children}
        </ContextMenu.Trigger>
        {shown === undefined ? null : (
          <ContextMenu.Portal>
            <ContextMenu.Positioner>
              <ContextMenu.Popup
                aria-label={_(TEXT_MENU_LABEL)}
                className="m-context-menu m-area-menu"
                finalFocus={root}
                // A PRESS IN THE MENU LEAVES THE EDITOR'S SELECTION ALONE, as the page's menu does.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
              >
                {shown.look === undefined || shown.word === undefined || shown.range === undefined ? null : (
                  <>
                    {shown.look.suggestions.length === 0 ? (
                      <ContextMenu.Item className="m-context-menu-item" disabled label={_(TEXT_MENU_NO_SUGGESTIONS)}>
                        <span>{_(TEXT_MENU_NO_SUGGESTIONS)}</span>
                      </ContextMenu.Item>
                    ) : (
                      shown.look.suggestions.map((suggestion) => (
                        <ContextMenu.Item
                          className="m-context-menu-item"
                          data-suggestion={suggestion}
                          key={suggestion}
                          label={suggestion}
                          onClick={() => {
                            const element = root.current;
                            if (element !== null && shown.range !== undefined) replaceRange(element, shown.range, suggestion);
                          }}
                        >
                          <strong>{suggestion}</strong>
                        </ContextMenu.Item>
                      ))
                    )}
                    <ContextMenu.Item
                      className="m-context-menu-item"
                      data-add-word=""
                      label={_(TEXT_MENU_ADD_WORD, { word: shown.word })}
                      onClick={() => {
                        const word = shown.word;
                        const refusal = word === undefined ? undefined : spell?.keep(word);
                        if (refusal !== undefined) onNotice(refusal);
                      }}
                    >
                      <span>{_(TEXT_MENU_ADD_WORD, { word: shown.word })}</span>
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="m-context-menu-separator" />
                  </>
                )}
                <ContextMenu.Item
                  className="m-context-menu-item"
                  data-verb="cut"
                  disabled={!shown.selected}
                  label={_(EDIT_CUT_TITLE)}
                  onClick={() => {
                    run('cut');
                  }}
                >
                  <span>{_(EDIT_CUT_TITLE)}</span>
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="m-context-menu-item"
                  data-verb="copy"
                  disabled={!shown.selected}
                  label={_(EDIT_COPY_TITLE)}
                  onClick={() => {
                    run('copy');
                  }}
                >
                  <span>{_(EDIT_COPY_TITLE)}</span>
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="m-context-menu-item"
                  data-verb="paste"
                  label={_(EDIT_PASTE_TITLE)}
                  onClick={() => {
                    run('paste');
                  }}
                >
                  <span>{_(EDIT_PASTE_TITLE)}</span>
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="m-context-menu-item"
                  data-verb="selectAll"
                  label={_(EDIT_SELECT_ALL_TITLE)}
                  onClick={() => {
                    run('selectAll');
                  }}
                >
                  <span>{_(EDIT_SELECT_ALL_TITLE)}</span>
                </ContextMenu.Item>
              </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        )}
      </ContextMenu.Root>
    </div>
  );
}
