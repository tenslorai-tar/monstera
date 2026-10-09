# Manual test checklist

<!-- GENERATED from the command registry by `packages/ui/src/manualChecklist.ts`; `App.test.tsx` holds this file
     equal to it. Regenerate with `npx vitest run packages/ui/src/App.test.tsx -t "manual test checklist" -u`.
     Do not edit by hand. -->

Every command the application registers — 252 — and the checks only the installed window can answer.
For each command: use it on a real document, see the correct effect, then save, close and reopen and see it kept
(the wired-tools rule, CLAUDE.md). A command that needs a selection, a second document or a key says so when it
is not available.

## The installed window

- [ ] Install the package, then open a PDF by double-clicking it in File Explorer: it opens in Monstera as a tab (the .pdf association).
- [ ] With Monstera already open, double-click a second PDF: it opens as a tab in the same window, and no second window appears.
- [ ] Choose **Monstera PDF Editor** in **Open with** for a PDF: it opens.
- [ ] Start menu, taskbar and Alt+Tab show the Monstera mark, never a blank or plated icon, in light and dark Windows themes.
- [ ] WCAG 2.4.3 — with a document open and focus in the ribbon, Alt+Tab to another application and back: focus returns where it was, and no overlay (Studio, a menu) stays open over the panels.
- [ ] WCAG 1.4.4 — on a display set to 150% and then 200% in Windows Settings › Display › Scale: the window opens at no more than the work area, nothing scrolls sideways, and every tool is reachable (the ribbon folds groups into its More).
- [ ] WCAG 1.4.11, 1.4.3 — with a Windows contrast theme on (Settings › Accessibility › Contrast themes): every control has a visible edge and every text is readable.
- [ ] WCAG 2.1.1, 2.1.2 — the window’s own title bar: minimise, maximise and close are reachable and work from the keyboard (Alt+Space), and nothing traps focus.
- [ ] WCAG 4.1.2 — with Narrator on (Ctrl+Win+Enter): the window’s title, the ribbon’s sections, a dialog’s title and a toast are announced.
- [ ] Help › Components: every component shows **Installed**; **Verify files** turns each to **Verified**.
- [ ] Uninstall from Settings › Apps › Installed apps: Monstera leaves no Start menu entry, and PDFs no longer offer it.

## Ribbon › Home

- [ ] **Export pages as images…** — Export · `document.export-page-images` · Shows: a toast · Help: *Save pages as pictures*
- [ ] **Export to Word…** — Export · `document.export-word` · Shows: a toast · Help: *Export to Word*
- [ ] **Export tables to Excel…** — Export · `document.export-excel` · Shows: a toast · Help: *Export tables to Excel*
- [ ] **Export to PowerPoint…** — Export · `document.export-powerpoint` · Shows: a toast · Help: *Export to PowerPoint*
- [ ] **Email…** — Export · `document.email` · Shows: a toast · Help: *Email or share a document*
- [ ] **Open PDF…** — File · `document.open` · Shows: on screen · Help: *Open a password-protected PDF*
- [ ] **Save** — File · `document.save` · Shows: a toast · Help: *Save your changes*
- [ ] **Print…** — File · `document.print` · Shows: a toast · Help: *Print a document*
- [ ] **Undo** — File · `document.undo` · Shows: on screen · Help: *Undo and redo changes*
- [ ] **Redo** — File · `document.redo` · Shows: on screen · Help: *Undo and redo changes*
- [ ] **Hand — drag to move the pages** — Quick tools · `view.hand` · Shows: on screen · Help: *Move between pages*
- [ ] **Select text** — Quick tools · `view.select-text` · Shows: on screen · Help: *Select and copy text*
- [ ] **Signature** — Quick tools · `annotate.signature` · Shows: on screen · Help: *Add your signature*

## Ribbon › Organize

- [ ] **Crop pages…** — Adjust · `document.crop-pages` · Shows: on screen · Help: *Crop pages*
- [ ] **Resize pages…** — Adjust · `document.resize-pages` · Shows: on screen · Help: *Resize pages*
- [ ] **Straighten crooked pages** — Adjust · `document.deskew-pages` · Shows: on screen · Help: *Straighten crooked scanned pages*
- [ ] **Page transition…** — Adjust · `document.page-transition` · Shows: a toast · Help: *Add page transitions for presenting*
- [ ] **Merge documents…** — Combine · `document.merge` · Shows: on screen · Help: *Merge PDFs into one*
- [ ] **Split…** — Combine · `document.split` · Shows: a toast · Help: *Split a document into several PDFs*
- [ ] **Bates numbering…** — Marks · `document.bates-number` · Shows: on screen · Help: *Add Bates numbers*
- [ ] **Headers and footers…** — Marks · `document.header-footer` · Shows: on screen · Help: *Add headers and footers*
- [ ] **Watermark…** — Marks · `document.watermark-pages` · Shows: on screen · Help: *Add a watermark*
- [ ] **Add page background…** — Marks · `document.page-background` · Shows: on screen · Help: *Add a page background*
- [ ] **Table of contents** — Marks · `document.generate-toc` · Shows: on screen · Help: *Add a table of contents*
- [ ] **Delete pages…** — Pages · `document.delete-pages` · Shows: on screen · Help: *Delete pages*
- [ ] **Insert from PDF…** — Pages · `document.insert-from-pdf` · Shows: on screen · Help: *Insert pages from another PDF*
- [ ] **Insert blank page** — Pages · `document.insert-blank-page` · Shows: on screen · Help: *Insert a blank page*
- [ ] **Insert image…** — Pages · `document.insert-image` · Shows: on screen · Help: *Add a picture as a new page*
- [ ] **Extract pages…** — Pages · `document.extract-pages` · Shows: a toast · Help: *Extract pages to a new PDF*
- [ ] **Replace pages…** — Pages · `document.replace-page` · Shows: on screen · Help: *Replace pages*
- [ ] **Duplicate page** — Pages · `document.duplicate-page` · Shows: on screen · Help: *Duplicate a page*
- [ ] **Delete page** — Pages · `document.delete-page` · Shows: on screen · Help: *Delete pages*
- [ ] **Move page up** — Pages · `document.move-page-earlier` · Shows: on screen · Help: *Change the order of pages*
- [ ] **Move page down** — Pages · `document.move-page-later` · Shows: on screen · Help: *Change the order of pages*
- [ ] **Import page as layer…** — Pages · `document.import-page-as-layer` · Shows: on screen · Help: *Import a page as a layer*
- [ ] **Delete duplicate pages…** — Pages · `document.find-duplicate-pages` · Shows: a result dialog · Help: *Delete duplicate pages*
- [ ] **Edit page in another app…** — Pages · `document.edit-page-externally` · Shows: on screen · Help: *Edit a page in another app*
- [ ] **Rotate page** — Rotate · `document.rotate-page` · Shows: on screen · Help: *Rotate pages*
- [ ] **Rotate page 180°** — Rotate · `document.rotate-page-180` · Shows: on screen · Help: *Rotate pages*
- [ ] **Rotate page 270°** — Rotate · `document.rotate-page-270` · Shows: on screen · Help: *Rotate pages*

## Ribbon › Edit

- [ ] **Find** — Find · `document.find` · Shows: on screen · Help: *Find and replace text*
- [ ] **Bold** — Format · `text.format.bold` · Shows: on screen
- [ ] **Italic** — Format · `text.format.italic` · Shows: on screen
- [ ] **Underline** — Format · `text.format.underline` · Shows: on screen
- [ ] **Superscript** — Format · `text.format.superscript` · Shows: on screen
- [ ] **Subscript** — Format · `text.format.subscript` · Shows: on screen
- [ ] **Align left** — Format · `text.format.align-left` · Shows: on screen
- [ ] **Centre** — Format · `text.format.align-center` · Shows: on screen
- [ ] **Align right** — Format · `text.format.align-right` · Shows: on screen
- [ ] **Bullets** — Format · `text.format.bullets` · Shows: on screen
- [ ] **Numbering** — Format · `text.format.numbering` · Shows: on screen
- [ ] **Increase indent** — Format · `text.format.indent-more` · Shows: on screen
- [ ] **Decrease indent** — Format · `text.format.indent-less` · Shows: on screen
- [ ] **Translate this page…** — Language · `edit.translate-page` · Shows: a toast · Help: *Translate a page*
- [ ] **Spell check** — Proofing · `document.spell-check` · Shows: on screen · Help: *Check spelling*
- [ ] **Word count** — Proofing · `document.word-count` · Shows: a result dialog · Help: *Count words and characters*
- [ ] **Edit text on the page** — Text · `text.edit` · Shows: on screen · Help: *Edit text on the page*
- [ ] **Add text** — Text · `text.add` · Shows: on screen
- [ ] **Edit all objects** — Text · `edit.objects-all` · Shows: on screen · Help: *Move, resize, recolour or remove things on a page*
- [ ] **Edit text objects** — Text · `edit.objects-text` · Shows: on screen · Help: *Move, resize, recolour or remove things on a page*
- [ ] **Edit images** — Text · `edit.objects-images` · Shows: on screen · Help: *Move, resize, recolour or remove things on a page*
- [ ] **Edit shapes** — Text · `edit.objects-shapes` · Shows: on screen · Help: *Move, resize, recolour or remove things on a page*
- [ ] **Copy** — Text · `edit.copy` · Shows: a toast · Help: *Select and copy text*
- [ ] **Add a barcode** — Text · `organize.barcode` · Shows: on screen · Help: *Add and read barcodes and QR codes*

## Ribbon › Comment

- [ ] **Link to a web address** — Links · `annotate.link-address` · Shows: on screen · Help: *Add a link to a web page or another page*
- [ ] **Link to a page** — Links · `annotate.link-page` · Shows: on screen · Help: *Add a link to a web page or another page*
- [ ] **Highlight text** — Markup · `annotate.highlight` · Shows: on screen · Help: *Highlight, underline or strike through text*
- [ ] **Underline text** — Markup · `annotate.underline` · Shows: on screen · Help: *Highlight, underline or strike through text*
- [ ] **Strikethrough text** — Markup · `annotate.strikeout` · Shows: on screen · Help: *Highlight, underline or strike through text*
- [ ] **Select annotations** — Markup · `annotate.select` · Shows: on screen · Help: *Change how annotations look*
- [ ] **Text box** — Markup · `annotate.text-box` · Shows: on screen · Help: *Add a text box*
- [ ] **Typewriter** — Markup · `annotate.typewriter` · Shows: on screen · Help: *Type text onto a page*
- [ ] **Freehand** — Markup · `annotate.ink` · Shows: on screen · Help: *Draw freehand*
- [ ] **Note** — Markup · `annotate.sticky-note` · Shows: on screen · Help: *Add a note (sticky note)*
- [ ] **Insertion mark** — Markup · `annotate.caret` · Shows: on screen · Help: *Mark where text should be inserted*
- [ ] **Erase annotation** — Markup · `annotate.eraser` · Shows: on screen · Help: *Erase annotations*
- [ ] **Callout** — Markup · `annotate.callout` · Shows: on screen · Help: *Add a callout*
- [ ] **Snapshot a region** — Markup · `view.snapshot` · Shows: on screen · Help: *Snapshot part of a page*
- [ ] **Comments list** — Markup · `view.show-comments` · Shows: on screen · Help: *See all comments in a document*
- [ ] **Measure distance** — Measure · `annotate.measure-distance` · Shows: on screen · Help: *Measure distance, area and perimeter*
- [ ] **Measure area** — Measure · `annotate.measure-area` · Shows: on screen · Help: *Measure distance, area and perimeter*
- [ ] **Measure perimeter** — Measure · `annotate.measure-perimeter` · Shows: on screen · Help: *Measure distance, area and perimeter*
- [ ] **Mark text for redaction** — Redact · `annotate.redact-text` · Shows: on screen · Help: *Redact (permanently remove) content*
- [ ] **Mark an area for redaction** — Redact · `annotate.redact` · Shows: on screen · Help: *Redact (permanently remove) content*
- [ ] **Rectangle** — Shapes · `annotate.rectangle` · Shows: on screen · Help: *Draw rectangles, ellipses, lines and arrows*
- [ ] **Ellipse** — Shapes · `annotate.ellipse` · Shows: on screen · Help: *Draw rectangles, ellipses, lines and arrows*
- [ ] **Line** — Shapes · `annotate.line` · Shows: on screen · Help: *Draw rectangles, ellipses, lines and arrows*
- [ ] **Arrow** — Shapes · `annotate.arrow` · Shows: on screen · Help: *Draw rectangles, ellipses, lines and arrows*
- [ ] **Polygon** — Shapes · `annotate.polygon` · Shows: on screen · Help: *Draw polygons, connected lines and clouds*
- [ ] **Connected lines** — Shapes · `annotate.polyline` · Shows: on screen · Help: *Draw polygons, connected lines and clouds*
- [ ] **Cloud** — Shapes · `annotate.cloud` · Shows: on screen · Help: *Draw polygons, connected lines and clouds*
- [ ] **Stamp** — Stamps · `annotate.stamp` · Shows: on screen · Help: *Add a stamp*
- [ ] **Place an image** — Stamps · `annotate.image` · Shows: on screen · Help: *Place a picture or stamp on a page*

## Ribbon › Forms

- [ ] **Export form data as JSON…** — Data · `document.export-form-data-json` · Shows: a toast · Help: *Export or import form data*
- [ ] **Export form data as XFDF…** — Data · `document.export-form-data-xfdf` · Shows: a toast · Help: *Export or import form data*
- [ ] **Export form data as FDF…** — Data · `document.export-form-data-fdf` · Shows: a toast · Help: *Export or import form data*
- [ ] **Import form data from JSON…** — Data · `document.import-form-data-json` · Shows: a toast · Help: *Export or import form data*
- [ ] **Import form data from XFDF…** — Data · `document.import-form-data-xfdf` · Shows: a toast · Help: *Export or import form data*
- [ ] **Import form data from FDF…** — Data · `document.import-form-data-fdf` · Shows: a toast · Help: *Export or import form data*
- [ ] **Draw a text field** — Fields · `forms.field-text` · Shows: on screen · Help: *Create form fields*
- [ ] **Draw a tick box** — Fields · `forms.field-checkbox` · Shows: on screen · Help: *Create form fields*
- [ ] **Draw a radio option** — Fields · `forms.field-radio` · Shows: on screen · Help: *Create form fields*
- [ ] **Draw a dropdown** — Fields · `forms.field-dropdown` · Shows: on screen · Help: *Create form fields*
- [ ] **Draw a list box** — Fields · `forms.field-listbox` · Shows: on screen · Help: *Create form fields*
- [ ] **Fields list** — Fields · `view.show-fields` · Shows: on screen · Help: *Delete a form field*
- [ ] **Find fields on this page…** — Manage · `document.find-flat-fields` · Shows: a result dialog · Help: *Find fields on a flat form*
- [ ] **Flatten form** — Manage · `document.flatten-form` · Shows: a toast · Help: *Flatten a form*
- [ ] **Tab order…** — Manage · `document.tab-order` · Shows: a toast · Help: *Change a form field*

## Ribbon › Protect

- [ ] **Password and permissions** — Encryption · `document.protect` · Shows: a toast · Help: *Set a password and permissions*
- [ ] **Sanitize document** — Encryption · `document.sanitize` · Shows: a toast · Help: *Sanitize a document*
- [ ] **Apply redactions** — Redact · `document.apply-redactions` · Shows: on screen · Help: *Redact (permanently remove) content*
- [ ] **Mark matches for redaction** — Redact · `document.redact-matches` · Shows: on screen · Help: *Find and redact words*
- [ ] **Sign with Certificate** — Signatures · `document.sign-document` · Shows: a toast · Help: *Sign a document digitally*
- [ ] **Signature & Certificate** — Signatures · `protect.signature` · Shows: on screen · Help: *Add a visible signature*
- [ ] **Check signatures** — Signatures · `document.check-signatures` · Shows: a result dialog · Help: *Check a document's signatures*
- [ ] **Send to DocuSign** — Signatures · `document.docusign-send` · Shows: a result dialog · Help: *Send a document for signing with DocuSign*
- [ ] **Save signed copy from DocuSign** — Signatures · `document.docusign-retrieve` · Shows: a toast · Help: *Send a document for signing with DocuSign*

## Ribbon › Review

- [ ] **Reading order** — Accessibility · `document.inspect-page-structure` · Shows: on screen · Help: *See a page's reading order*
- [ ] **Accessibility check** — Accessibility · `document.accessibility-check` · Shows: on screen · Help: *Run an accessibility check*
- [ ] **Open the assistant** — AI · `ai.open-assistant` · Shows: on screen · Help: *Ask the AI assistant about a document*
- [ ] **Set up AI…** — AI · `ai.setup` · Shows: a toast · Help: *Get and add keys for AI and online reading services*
- [ ] **Summarise comments** — AI · `ai.summarise-comments` · Shows: on screen · Help: *Summarise a document's comments with AI*
- [ ] **Import comments from XFDF…** — Comment files · `document.import-annotations-xfdf` · Shows: a toast · Help: *Export or import comments*
- [ ] **Import comments from FDF…** — Comment files · `document.import-annotations-fdf` · Shows: a toast · Help: *Export or import comments*
- [ ] **Import comments from JSON…** — Comment files · `document.import-annotations-json` · Shows: a toast · Help: *Export or import comments*
- [ ] **Export comments as XFDF…** — Comment files · `document.export-annotations-xfdf` · Shows: a toast · Help: *Export or import comments*
- [ ] **Export comments as FDF…** — Comment files · `document.export-annotations-fdf` · Shows: a toast · Help: *Export or import comments*
- [ ] **Export comments as JSON…** — Comment files · `document.export-annotations-json` · Shows: a toast · Help: *Export or import comments*
- [ ] **Compare documents…** — Compare · `document.compare` · Shows: on screen · Help: *Compare two documents side by side*

## Ribbon › Tools

- [ ] **Reveal diagnostics log** — Application · `log.reveal` · Shows: on screen · Help: *If something goes wrong*
- [ ] **Components** — Application · `app.components` · Shows: on screen · Help: *Check Monstera's components*
- [ ] **About** — Application · `app.about` · Shows: on screen · Help: *See the version and licences*
- [ ] **Help centre** — Application · `app.help` · Shows: on screen · Help: *Get help with what you are doing*
- [ ] **Keyboard shortcuts** — Application · `app.keyboard-shortcuts` · Shows: on screen · Help: *See and change keyboard shortcuts*
- [ ] **Settings** — Application · `app.settings` · Shows: on screen · Help: *Change Monstera's settings*
- [ ] **Export as PDF/A…** — Convert · `document.export-pdfa` · Shows: a toast · Help: *Save an archival copy (PDF/A)*
- [ ] **Save a smaller copy…** — Convert · `document.optimize` · Shows: a toast · Help: *Make a smaller copy of a PDF*
- [ ] **Export text…** — Convert · `document.export-text` · Shows: a toast · Help: *Save the text as a text file*
- [ ] **Export text with layout…** — Convert · `document.export-layout-text` · Shows: a toast · Help: *Save the text as a text file*
- [ ] **New PDF from Word, Excel or PowerPoint…** — Create · `document.new-from-office` · Shows: on screen · Help: *Make a PDF from a Word, Excel or PowerPoint file*
- [ ] **New PDF from Markdown…** — Create · `document.new-from-markdown` · Shows: on screen · Help: *Make a PDF from a Markdown file*
- [ ] **Insert from Markdown…** — Create · `document.append-markdown` · Shows: on screen · Help: *Make a PDF from a Markdown file*
- [ ] **New PDF table from CSV…** — Create · `document.new-from-csv` · Shows: on screen · Help: *Make a PDF table from a CSV file*
- [ ] **New PDF from images…** — Create · `document.new-from-images` · Shows: on screen · Help: *Make a PDF from pictures*
- [ ] **Open from web address…** — Create · `document.open-from-url` · Shows: on screen · Help: *Open a PDF from a web address*
- [ ] **New PDF from camera…** — Create · `document.new-from-camera` · Shows: on screen · Help: *Make a PDF with your camera*
- [ ] **Zoom in** — Display · `view.zoom-in` · Shows: on screen · Help: *Read the status bar*
- [ ] **Zoom out** — Display · `view.zoom-out` · Shows: on screen · Help: *Read the status bar*
- [ ] **Fit width** — Display · `view.fit-width` · Shows: on screen · Help: *Read the status bar*
- [ ] **Fit page** — Display · `view.fit-page` · Shows: on screen · Help: *Read the status bar*
- [ ] **Show rulers** — Display · `view.toggle-rulers` · Shows: on screen · Help: *Show rulers and a grid*
- [ ] **Show grid** — Display · `view.toggle-grid` · Shows: on screen · Help: *Show rulers and a grid*
- [ ] **Dim pages** — Display · `view.toggle-dark-page` · Shows: on screen · Help: *Read with dim pages*
- [ ] **Loupe** — Display · `view.toggle-loupe` · Shows: on screen · Help: *Magnify part of a page with the loupe*
- [ ] **Split view** — Display · `view.toggle-split` · Shows: on screen · Help: *See two pages of a document at once*
- [ ] **Convert a scan…** — OCR · `document.convert-scan` · Shows: a toast · Help: *Convert a scan*
- [ ] **Make scanned pages searchable** — OCR · `document.ocr` · Shows: a result dialog · Help: *Make scanned pages searchable (OCR)*
- [ ] **Export a searchable copy** — OCR · `document.export-searchable` · Shows: a toast · Help: *Save a searchable copy of a scan*
- [ ] **Clean up scanned pages** — OCR · `document.enhance-scans` · Shows: on screen · Help: *Clean up scanned pages*
- [ ] **Straighten photographed pages** — OCR · `document.straighten-scans` · Shows: on screen · Help: *Straighten photographed pages*
- [ ] **Read barcodes** — OCR · `document.read-barcodes` · Shows: a result dialog · Help: *Add and read barcodes and QR codes*
- [ ] **Recognise text in a box** — OCR · `tools.ocr-region` · Shows: on screen · Help: *Recognise text in part of a page*
- [ ] **Send a box to Azure to recognise** — OCR · `tools.cloud-region` · Shows: on screen · Help: *Get and add keys for AI and online reading services*
- [ ] **Send a box to Claude to recognise** — OCR · `annotate.claude-region` · Shows: on screen · Help: *Get and add keys for AI and online reading services*

## Context menus

- [ ] **Close tab** · `document.close-tab` · Shows: on screen · Help: *Close a document that has unsaved changes*
- [ ] **Copy** · `text.copy` · Shows: a toast · Help: *Select and copy text*
- [ ] **Edit comment…** · `annotate.edit-selection` · Shows: on screen · Help: *Edit a comment or reply to it*
- [ ] **Close other tabs** · `document.close-others` · Shows: on screen · Help: *Use right-click menus*
- [ ] **Highlight** · `text.highlight` · Shows: on screen · Help: *Highlight, underline or strike through text*
- [ ] **Reply…** · `annotate.reply-selection` · Shows: on screen · Help: *Edit a comment or reply to it*
- [ ] **Draft a reply with AI** · `ai.draft-reply` · Shows: on screen · Help: *Ask AI about selected text or a comment*
- [ ] **Paste annotations** · `annotate.paste` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Open side by side** · `document.open-side-by-side` · Shows: on screen · Help: *Compare two documents side by side*
- [ ] **Properties** · `annotate.properties` · Shows: on screen · Help: *Change how annotations look*
- [ ] **Underline** · `text.underline` · Shows: on screen · Help: *Highlight, underline or strike through text*
- [ ] **Copy** · `annotate.copy-selection` · Shows: a toast · Help: *Select, move, resize and delete annotations*
- [ ] **Strikethrough** · `text.strikeout` · Shows: on screen · Help: *Highlight, underline or strike through text*
- [ ] **Add comment** · `text.comment` · Shows: on screen · Help: *Add a note (sticky note)*
- [ ] **Delete selection** · `annotate.delete-selection` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Mark for redaction** · `text.redact` · Shows: on screen · Help: *Redact (permanently remove) content*
- [ ] **Search for this** · `text.search` · Shows: on screen · Help: *Find words in a document*
- [ ] **Ask AI** · `ai.ask-selection` · Shows: on screen · Help: *Ask AI about selected text or a comment*
- [ ] **Explain** · `ai.explain-selection` · Shows: on screen · Help: *Ask AI about selected text or a comment*
- [ ] **Summarise** · `ai.summarise-selection` · Shows: on screen · Help: *Ask AI about selected text or a comment*
- [ ] **Translate** · `ai.translate-selection` · Shows: on screen · Help: *Ask AI about selected text or a comment*

## Menu bar

- [ ] **Check for updates** · `app.check-for-updates` · Shows: on screen
- [ ] **Cut** · `edit.cut` · Shows: on screen
- [ ] **Go to page** · `view.go-to` · Shows: on screen · Help: *Move between pages*
- [ ] **Match the system theme** · `view.theme-system` · Shows: on screen
- [ ] **Pages panel** · `view.show-pages` · Shows: on screen
- [ ] **Ribbon layout** · `view.layout-ribbon` · Shows: on screen · Help: *Choose a layout: Ribbon, Studio or Focus*
- [ ] **Show or hide the document panel** · `view.toggle-panel` · Shows: on screen · Help: *Use the document panel*
- [ ] **Clear recent files** · `document.clear-recent` · Shows: on screen · Help: *Reopen a recent file*
- [ ] **Bookmarks panel** · `view.show-bookmarks` · Shows: on screen
- [ ] **Command palette** · `view.command-palette` · Shows: on screen · Help: *Find any tool by name*
- [ ] **Light theme** · `view.theme-light` · Shows: on screen
- [ ] **Save a copy…** · `document.save-copy` · Shows: a toast · Help: *Save a copy under another name*
- [ ] **Show or hide the properties panel** · `view.toggle-context-panel` · Shows: on screen · Help: *Use the properties panel*
- [ ] **Studio layout** · `view.layout-studio` · Shows: on screen · Help: *Choose a layout: Ribbon, Studio or Focus*
- [ ] **Restore a previous version…** · `document.restore-version` · Shows: a toast · Help: *Save your changes*
- [ ] **Actual size** · `view.actual-size` · Shows: on screen
- [ ] **Autoscroll** · `view.autoscroll` · Shows: on screen · Help: *Move between pages*
- [ ] **Cloud storage…** · `cloud.storage` · Shows: on screen · Help: *Open and save PDFs in OneDrive or Google Drive*
- [ ] **Dark theme** · `view.theme-dark` · Shows: on screen
- [ ] **Focus layout** · `view.layout-focus` · Shows: on screen · Help: *Choose a layout: Ribbon, Studio or Focus*
- [ ] **Paste** · `edit.paste` · Shows: on screen
- [ ] **Save back to cloud** · `cloud.save-back` · Shows: a toast · Help: *Open and save PDFs in OneDrive or Google Drive*
- [ ] **Reset Float bar position** · `view.reset-float-bar` · Shows: on screen · Help: *Use the Float bar*
- [ ] **Select all** · `edit.select-all` · Shows: on screen
- [ ] **Start screen** · `app.start-screen` · Shows: on screen
- [ ] **Layers panel** · `view.show-layers` · Shows: on screen
- [ ] **Search panel** · `view.show-search` · Shows: on screen
- [ ] **Properties panel** · `view.show-properties` · Shows: on screen
- [ ] **Exit** · `app.exit` · Shows: on screen

## Menu bar (centre)

- [ ] **Donate** · `app.donate` · Shows: on screen · Help: *Support Monstera with a donation*
- [ ] **Rate Us** · `app.rate` · Shows: on screen · Help: *Rate Monstera*
- [ ] **Update available** · `app.update-available` · Shows: on screen

## Properties tab

- [ ] **Copy to other pages…** · `forms.copy-to-pages` · Shows: on screen · Help: *Change a form field*
- [ ] **Align left edges** · `forms.arrange.align-left` · Shows: on screen · Help: *Change a form field*
- [ ] **Align right edges** · `forms.arrange.align-right` · Shows: on screen
- [ ] **Align tops** · `forms.arrange.align-top` · Shows: on screen
- [ ] **Align bottoms** · `forms.arrange.align-bottom` · Shows: on screen
- [ ] **Centre across the first field** · `forms.arrange.centre-horizontally` · Shows: on screen
- [ ] **Centre down the first field** · `forms.arrange.centre-vertically` · Shows: on screen
- [ ] **Same width as the first field** · `forms.arrange.same-width` · Shows: on screen
- [ ] **Same height as the first field** · `forms.arrange.same-height` · Shows: on screen
- [ ] **Same size as the first field** · `forms.arrange.same-size` · Shows: on screen · Help: *Change a form field*

## Start screen

- [ ] **Annotate & mark up** · `start.annotate` · Shows: on screen · Help: *Use the start screen*
- [ ] **Fill & create forms** · `start.forms` · Shows: on screen · Help: *Use the start screen*
- [ ] **OCR scanned pages** · `start.ocr` · Shows: on screen · Help: *Make scanned pages searchable (OCR)*
- [ ] **Split & merge** · `start.split-merge` · Shows: on screen · Help: *Use the start screen*
- [ ] **Encrypt & sign** · `start.encrypt-sign` · Shows: on screen · Help: *Set a password and permissions*
- [ ] **Export anywhere** · `start.export` · Shows: on screen · Help: *Use the start screen*

## Status bar

- [ ] **First page** · `view.page-first` · Shows: on screen · Help: *Move between pages*
- [ ] **Next page** · `view.page-next` · Shows: on screen · Help: *Move between pages*
- [ ] **Show or hide the Float bar** · `view.toggle-quick-toolbar` · Shows: on screen · Help: *Read the status bar*
- [ ] **Last page** · `view.page-last` · Shows: on screen · Help: *Move between pages*
- [ ] **Previous page** · `view.page-previous` · Shows: on screen · Help: *Move between pages*

## Command palette and keyboard only

- [ ] **Move selection down** · `annotate.nudge-down` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection down** · `annotate.nudge-down-far` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection left** · `annotate.nudge-left` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection left** · `annotate.nudge-left-far` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection right** · `annotate.nudge-right` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection right** · `annotate.nudge-right-far` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection up** · `annotate.nudge-up` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection up** · `annotate.nudge-up-far` · Shows: on screen · Help: *Select, move, resize and delete annotations*
- [ ] **Select every comment on this page** · `annotate.select-all` · Shows: on screen
- [ ] **Back** · `view.go-back` · Shows: on screen · Help: *Move between pages*
- [ ] **Forward** · `view.go-forward` · Shows: on screen · Help: *Move between pages*
- [ ] **Leave Focus** · `view.leave-focus` · Shows: on screen · Help: *Choose a layout: Ribbon, Studio or Focus*
- [ ] **Move to the next pane** · `view.next-pane` · Shows: on screen
- [ ] **Move to the previous pane** · `view.previous-pane` · Shows: on screen
