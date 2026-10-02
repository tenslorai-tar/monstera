# Manual test checklist

<!-- GENERATED from the command registry by `packages/ui/src/manualChecklist.ts`; `App.test.tsx` holds this file
     equal to it. Regenerate with `npx vitest run packages/ui/src/App.test.tsx -t "manual test checklist" -u`.
     Do not edit by hand. -->

Every command the application registers — 221 — and the checks only the installed window can answer.
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

- [ ] **Export pages as images…** — Export · `document.export-page-images` · Help: *Save pages as pictures*
- [ ] **Export to Word…** — Export · `document.export-word` · Help: *Export to Word*
- [ ] **Export tables to Excel…** — Export · `document.export-excel` · Help: *Export tables to Excel*
- [ ] **Email…** — Export · `document.email` · Help: *Email or share a document*
- [ ] **Open PDF…** — File · `document.open` · Help: *Open a password-protected PDF*
- [ ] **Save** — File · `document.save` · Help: *Save your changes*
- [ ] **Print…** — File · `document.print` · Help: *Print a document*
- [ ] **Undo** — File · `document.undo` · Help: *Undo and redo changes*
- [ ] **Redo** — File · `document.redo` · Help: *Undo and redo changes*
- [ ] **Hand — drag to move the pages** — Quick tools · `view.hand` · Help: *Move between pages*
- [ ] **Select text** — Quick tools · `view.select-text` · Help: *Select and copy text*
- [ ] **Signature** — Quick tools · `annotate.signature` · Help: *Add your signature*

## Ribbon › Organize

- [ ] **Crop pages…** — Adjust · `document.crop-pages` · Help: *Crop pages*
- [ ] **Resize pages…** — Adjust · `document.resize-pages` · Help: *Resize pages*
- [ ] **Straighten crooked pages** — Adjust · `document.deskew-pages` · Help: *Straighten crooked scanned pages*
- [ ] **Page transition…** — Adjust · `document.page-transition` · Help: *Add page transitions for presenting*
- [ ] **Merge a document…** — Combine · `document.merge` · Help: *Merge PDFs into one*
- [ ] **Split…** — Combine · `document.split` · Help: *Split a document into several PDFs*
- [ ] **Bates numbering…** — Marks · `document.bates-number` · Help: *Add Bates numbers*
- [ ] **Headers and footers…** — Marks · `document.header-footer` · Help: *Add headers and footers*
- [ ] **Watermark…** — Marks · `document.watermark-pages` · Help: *Add a watermark*
- [ ] **Add page background** — Marks · `document.page-background` · Help: *Add a page background*
- [ ] **Table of contents** — Marks · `document.generate-toc` · Help: *Add a table of contents*
- [ ] **Add a barcode** — Marks · `organize.barcode` · Help: *Add and read barcodes and QR codes*
- [ ] **Read barcodes** — Marks · `document.read-barcodes` · Help: *Add and read barcodes and QR codes*
- [ ] **Delete pages…** — Pages · `document.delete-pages` · Help: *Delete pages*
- [ ] **Rotate page** — Pages · `document.rotate-page` · Help: *Rotate pages*
- [ ] **Rotate page 180°** — Pages · `document.rotate-page-180` · Help: *Rotate pages*
- [ ] **Rotate page 270°** — Pages · `document.rotate-page-270` · Help: *Rotate pages*
- [ ] **Insert from PDF…** — Pages · `document.insert-from-pdf` · Help: *Insert pages from another PDF*
- [ ] **Extract pages…** — Pages · `document.extract-pages` · Help: *Extract pages to a new PDF*
- [ ] **Replace page…** — Pages · `document.replace-page` · Help: *Replace a page*
- [ ] **Duplicate page** — Pages · `document.duplicate-page` · Help: *Duplicate a page*
- [ ] **Delete page** — Pages · `document.delete-page` · Help: *Delete pages*
- [ ] **Insert blank page** — Pages · `document.insert-blank-page` · Help: *Insert a blank page*
- [ ] **Insert image…** — Pages · `document.insert-image` · Help: *Add a picture as a new page*
- [ ] **Move page up** — Pages · `document.move-page-earlier` · Help: *Change the order of pages*
- [ ] **Move page down** — Pages · `document.move-page-later` · Help: *Change the order of pages*
- [ ] **Import page as layer…** — Pages · `document.import-page-as-layer` · Help: *Import a page as a layer*
- [ ] **Find duplicate pages…** — Pages · `document.find-duplicate-pages` · Help: *Find and remove duplicate pages*
- [ ] **Edit page in another app…** — Pages · `document.edit-page-externally` · Help: *Edit a page in another app*

## Ribbon › Edit

- [ ] **Find** — Find · `document.find` · Help: *Find and replace text*
- [ ] **Translate this page…** — Language · `edit.translate-page` · Help: *Translate a page*
- [ ] **Spell check** — Proofing · `document.spell-check` · Help: *Check spelling*
- [ ] **Word count** — Proofing · `document.word-count` · Help: *Count words and characters*
- [ ] **Edit text on the page** — Text · `text.edit` · Help: *Edit text on the page*
- [ ] **Edit an object on page** — Text · `document.edit-page-object` · Help: *Move, resize, recolour or remove things on a page*
- [ ] **Copy** — Text · `edit.copy` · Help: *Select and copy text*

## Ribbon › Comment

- [ ] **Link to a web address** — Links · `annotate.link-address` · Help: *Add a link to a web page or another page*
- [ ] **Link to a page** — Links · `annotate.link-page` · Help: *Add a link to a web page or another page*
- [ ] **Highlight text** — Markup · `annotate.highlight` · Help: *Highlight, underline or strike through text*
- [ ] **Underline text** — Markup · `annotate.underline` · Help: *Highlight, underline or strike through text*
- [ ] **Strike through text** — Markup · `annotate.strikeout` · Help: *Highlight, underline or strike through text*
- [ ] **Select annotations** — Markup · `annotate.select` · Help: *Change how annotations look*
- [ ] **Freehand** — Markup · `annotate.ink` · Help: *Draw freehand*
- [ ] **Text box** — Markup · `annotate.text-box` · Help: *Add a text box*
- [ ] **Typewriter** — Markup · `annotate.typewriter` · Help: *Type text onto a page*
- [ ] **Note** — Markup · `annotate.sticky-note` · Help: *Add a note (sticky note)*
- [ ] **Insertion mark** — Markup · `annotate.caret` · Help: *Mark where text should be inserted*
- [ ] **Erase annotation** — Markup · `annotate.eraser` · Help: *Erase annotations*
- [ ] **Callout** — Markup · `annotate.callout` · Help: *Add a callout*
- [ ] **Snapshot a region** — Markup · `view.snapshot` · Help: *Snapshot part of a page*
- [ ] **Comments list** — Markup · `view.show-comments` · Help: *See all comments in a document*
- [ ] **Measure distance** — Measure · `annotate.measure-distance` · Help: *Measure distance, area and perimeter*
- [ ] **Measure area** — Measure · `annotate.measure-area` · Help: *Measure distance, area and perimeter*
- [ ] **Measure perimeter** — Measure · `annotate.measure-perimeter` · Help: *Measure distance, area and perimeter*
- [ ] **Mark for redaction** — Redact · `annotate.redact` · Help: *Redact (permanently remove) content*
- [ ] **Rectangle** — Shapes · `annotate.rectangle` · Help: *Draw rectangles, ellipses, lines and arrows*
- [ ] **Ellipse** — Shapes · `annotate.ellipse` · Help: *Draw rectangles, ellipses, lines and arrows*
- [ ] **Line** — Shapes · `annotate.line` · Help: *Draw rectangles, ellipses, lines and arrows*
- [ ] **Arrow** — Shapes · `annotate.arrow` · Help: *Draw rectangles, ellipses, lines and arrows*
- [ ] **Polygon** — Shapes · `annotate.polygon` · Help: *Draw polygons, connected lines and clouds*
- [ ] **Connected lines** — Shapes · `annotate.polyline` · Help: *Draw polygons, connected lines and clouds*
- [ ] **Cloud** — Shapes · `annotate.cloud` · Help: *Draw polygons, connected lines and clouds*
- [ ] **Stamp** — Stamps · `annotate.stamp` · Help: *Add a stamp*
- [ ] **Place an image** — Stamps · `annotate.image` · Help: *Place a picture or stamp on a page*

## Ribbon › Forms

- [ ] **Export form data as JSON…** — Data · `document.export-form-data-json` · Help: *Export or import form data*
- [ ] **Export form data as XFDF…** — Data · `document.export-form-data-xfdf` · Help: *Export or import form data*
- [ ] **Export form data as FDF…** — Data · `document.export-form-data-fdf` · Help: *Export or import form data*
- [ ] **Import form data from JSON…** — Data · `document.import-form-data-json` · Help: *Export or import form data*
- [ ] **Import form data from XFDF…** — Data · `document.import-form-data-xfdf` · Help: *Export or import form data*
- [ ] **Import form data from FDF…** — Data · `document.import-form-data-fdf` · Help: *Export or import form data*
- [ ] **Draw a text field** — Fields · `forms.field-text` · Help: *Create form fields*
- [ ] **Draw a tick box** — Fields · `forms.field-checkbox` · Help: *Create form fields*
- [ ] **Draw a radio option** — Fields · `forms.field-radio` · Help: *Create form fields*
- [ ] **Draw a dropdown** — Fields · `forms.field-dropdown` · Help: *Create form fields*
- [ ] **Draw a list box** — Fields · `forms.field-listbox` · Help: *Create form fields*
- [ ] **Fields list** — Fields · `view.show-fields` · Help: *Delete a form field*
- [ ] **Find fields on this page…** — Manage · `document.find-flat-fields` · Help: *Find fields on a flat form*
- [ ] **Flatten form** — Manage · `document.flatten-form` · Help: *Flatten a form*

## Ribbon › Protect

- [ ] **Password and permissions** — Encryption · `document.protect` · Help: *Set a password and permissions*
- [ ] **Sanitize document** — Encryption · `document.sanitize` · Help: *Sanitize a document*
- [ ] **Apply redactions** — Redact · `document.apply-redactions` · Help: *Redact (permanently remove) content*
- [ ] **Mark matches for redaction** — Redact · `document.redact-matches` · Help: *Find and redact words*
- [ ] **Sign document** — Signatures · `document.sign-document` · Help: *Sign a document digitally*
- [ ] **Sign with certificate** — Signatures · `protect.signature` · Help: *Add a visible signature*
- [ ] **Check signatures** — Signatures · `document.check-signatures` · Help: *Check a document's signatures*
- [ ] **Send to DocuSign** — Signatures · `document.docusign-send` · Help: *Send a document for signing with DocuSign*
- [ ] **Save signed copy from DocuSign** — Signatures · `document.docusign-retrieve` · Help: *Send a document for signing with DocuSign*

## Ribbon › Review

- [ ] **Reading order** — Accessibility · `document.inspect-page-structure` · Help: *See a page's reading order and tags*
- [ ] **Accessibility check** — Accessibility · `document.accessibility-check` · Help: *Run an accessibility check*
- [ ] **Open the assistant** — AI · `ai.open-assistant` · Help: *Ask the AI assistant about a document*
- [ ] **Set up AI…** — AI · `ai.setup` · Help: *Get and add keys for AI and online reading services*
- [ ] **Summarise comments** — AI · `ai.summarise-comments` · Help: *Summarise a document's comments with AI*
- [ ] **Import comments from XFDF…** — Comment files · `document.import-annotations-xfdf` · Help: *Export or import comments*
- [ ] **Import comments from FDF…** — Comment files · `document.import-annotations-fdf` · Help: *Export or import comments*
- [ ] **Import comments from JSON…** — Comment files · `document.import-annotations-json` · Help: *Export or import comments*
- [ ] **Export comments as XFDF…** — Comment files · `document.export-annotations-xfdf` · Help: *Export or import comments*
- [ ] **Export comments as FDF…** — Comment files · `document.export-annotations-fdf` · Help: *Export or import comments*
- [ ] **Export comments as JSON…** — Comment files · `document.export-annotations-json` · Help: *Export or import comments*
- [ ] **Compare documents…** — Compare · `document.compare` · Help: *Compare two documents side by side*

## Ribbon › Tools

- [ ] **Settings** — Application · `app.settings` · Help: *Change Monstera's settings*
- [ ] **Reveal diagnostics log** — Application · `log.reveal` · Help: *If something goes wrong*
- [ ] **Components** — Application · `app.components` · Help: *Check Monstera's components*
- [ ] **About** — Application · `app.about` · Help: *See the version and licences*
- [ ] **Help centre** — Application · `app.help` · Help: *Get help with what you are doing*
- [ ] **Keyboard shortcuts** — Application · `app.keyboard-shortcuts` · Help: *See and change keyboard shortcuts*
- [ ] **Export as PDF/A…** — Convert · `document.export-pdfa` · Help: *Save an archival copy (PDF/A)*
- [ ] **Save a smaller copy…** — Convert · `document.optimize` · Help: *Make a smaller copy of a PDF*
- [ ] **Export to PowerPoint…** — Convert · `document.export-powerpoint` · Help: *Export to PowerPoint*
- [ ] **Export text…** — Convert · `document.export-text` · Help: *Save the text as a text file*
- [ ] **Export text with layout…** — Convert · `document.export-layout-text` · Help: *Save the text as a text file*
- [ ] **New PDF from Word, Excel or PowerPoint…** — Create · `document.new-from-office` · Help: *Make a PDF from a Word, Excel or PowerPoint file*
- [ ] **New PDF from Markdown…** — Create · `document.new-from-markdown` · Help: *Make a PDF from a Markdown file*
- [ ] **Add pages from Markdown…** — Create · `document.append-markdown` · Help: *Make a PDF from a Markdown file*
- [ ] **New PDF table from CSV…** — Create · `document.new-from-csv` · Help: *Make a PDF table from a CSV file*
- [ ] **New PDF from images…** — Create · `document.new-from-images` · Help: *Make a PDF from pictures*
- [ ] **Open from web address…** — Create · `document.open-from-url` · Help: *Open a PDF from a web address*
- [ ] **New PDF from camera…** — Create · `document.new-from-camera` · Help: *Make a PDF with your camera*
- [ ] **Zoom in** — Display · `view.zoom-in` · Help: *Read the status bar*
- [ ] **Zoom out** — Display · `view.zoom-out` · Help: *Read the status bar*
- [ ] **Fit width** — Display · `view.fit-width` · Help: *Read the status bar*
- [ ] **Fit page** — Display · `view.fit-page` · Help: *Read the status bar*
- [ ] **Show rulers** — Display · `view.toggle-rulers` · Help: *Show rulers and a grid*
- [ ] **Show grid** — Display · `view.toggle-grid` · Help: *Show rulers and a grid*
- [ ] **Dim Pages** — Display · `view.toggle-dark-page` · Help: *Read with dim pages*
- [ ] **Loupe** — Display · `view.toggle-loupe` · Help: *Magnify part of a page with the loupe*
- [ ] **Split view** — Display · `view.toggle-split` · Help: *See two pages of a document at once*
- [ ] **Make scanned pages searchable** — OCR · `document.ocr` · Help: *Make scanned pages searchable (OCR)*
- [ ] **Export a searchable copy** — OCR · `document.export-searchable` · Help: *Save a searchable copy of a scan*
- [ ] **Clean up scanned pages** — OCR · `document.enhance-scans` · Help: *Clean up scanned pages*
- [ ] **Straighten photographed pages** — OCR · `document.straighten-scans` · Help: *Straighten photographed pages*
- [ ] **Recognise text in a box** — OCR · `tools.ocr-region` · Help: *Recognise text in part of a page*
- [ ] **Send a box to Azure to recognise** — OCR · `tools.cloud-region` · Help: *Get and add keys for AI and online reading services*
- [ ] **Send a box to Claude to recognise** — OCR · `annotate.claude-region` · Help: *Get and add keys for AI and online reading services*

## Context menus

- [ ] **Close tab** · `document.close-tab` · Help: *Close a document that has unsaved changes*
- [ ] **Copy** · `text.copy` · Help: *Select and copy text*
- [ ] **Edit comment…** · `annotate.edit-selection` · Help: *Edit a comment or reply to it*
- [ ] **Close other tabs** · `document.close-others` · Help: *Use right-click menus*
- [ ] **Highlight** · `text.highlight` · Help: *Highlight, underline or strike through text*
- [ ] **Reply…** · `annotate.reply-selection` · Help: *Edit a comment or reply to it*
- [ ] **Draft a reply with AI** · `ai.draft-reply` · Help: *Ask AI about selected text or a comment*
- [ ] **Paste annotations** · `annotate.paste` · Help: *Select, move, resize and delete annotations*
- [ ] **Open side by side** · `document.open-side-by-side` · Help: *Compare two documents side by side*
- [ ] **Properties** · `annotate.properties` · Help: *Change how annotations look*
- [ ] **Underline** · `text.underline` · Help: *Highlight, underline or strike through text*
- [ ] **Copy** · `annotate.copy-selection` · Help: *Select, move, resize and delete annotations*
- [ ] **Strikethrough** · `text.strikeout` · Help: *Highlight, underline or strike through text*
- [ ] **Add comment** · `text.comment` · Help: *Add a note (sticky note)*
- [ ] **Delete selected annotations** · `annotate.delete-selection` · Help: *Select, move, resize and delete annotations*
- [ ] **Mark for redaction** · `text.redact` · Help: *Redact (permanently remove) content*
- [ ] **Search for this** · `text.search` · Help: *Find words in a document*
- [ ] **Ask AI** · `ai.ask-selection` · Help: *Ask AI about selected text or a comment*
- [ ] **Explain** · `ai.explain-selection` · Help: *Ask AI about selected text or a comment*
- [ ] **Summarise** · `ai.summarise-selection` · Help: *Ask AI about selected text or a comment*
- [ ] **Translate** · `ai.translate-selection` · Help: *Ask AI about selected text or a comment*

## Menu bar

- [ ] **Check for updates** · `app.check-for-updates`
- [ ] **Cut** · `edit.cut`
- [ ] **Go to page** · `view.go-to` · Help: *Move between pages*
- [ ] **Match the system theme** · `view.theme-system`
- [ ] **Pages panel** · `view.show-pages`
- [ ] **Ribbon layout** · `view.layout-ribbon` · Help: *Choose a layout: Ribbon, Studio or Focus*
- [ ] **Show or hide the document panel** · `view.toggle-panel` · Help: *Use the document panel*
- [ ] **Bookmarks panel** · `view.show-bookmarks`
- [ ] **Command palette** · `view.command-palette` · Help: *Find any tool by name*
- [ ] **Light theme** · `view.theme-light`
- [ ] **Save a copy…** · `document.save-copy` · Help: *Save a copy under another name*
- [ ] **Show or hide the properties panel** · `view.toggle-context-panel` · Help: *Use the properties panel*
- [ ] **Studio layout** · `view.layout-studio` · Help: *Choose a layout: Ribbon, Studio or Focus*
- [ ] **Actual size** · `view.actual-size`
- [ ] **Autoscroll** · `view.autoscroll` · Help: *Move between pages*
- [ ] **Cloud storage…** · `cloud.storage` · Help: *Open and save PDFs in OneDrive or Google Drive*
- [ ] **Dark theme** · `view.theme-dark`
- [ ] **Focus layout** · `view.layout-focus` · Help: *Choose a layout: Ribbon, Studio or Focus*
- [ ] **Paste** · `edit.paste`
- [ ] **Save back to cloud** · `cloud.save-back` · Help: *Open and save PDFs in OneDrive or Google Drive*
- [ ] **Reset Float bar position** · `view.reset-float-bar` · Help: *Use the Float bar*
- [ ] **Select all** · `edit.select-all`
- [ ] **Start screen** · `app.start-screen`
- [ ] **Layers panel** · `view.show-layers`
- [ ] **Search panel** · `view.show-search`
- [ ] **Properties panel** · `view.show-properties`
- [ ] **Exit** · `app.exit`

## Menu bar (centre)

- [ ] **Donate** · `app.donate` · Help: *Support Monstera with a donation*
- [ ] **Rate Us** · `app.rate` · Help: *Rate Monstera*
- [ ] **Update available** · `app.update-available`

## Start screen

- [ ] **Annotate & mark up** · `start.annotate` · Help: *Use the start screen*
- [ ] **Fill & create forms** · `start.forms` · Help: *Use the start screen*
- [ ] **OCR scanned pages** · `start.ocr` · Help: *Make scanned pages searchable (OCR)*
- [ ] **Split & merge** · `start.split-merge` · Help: *Use the start screen*
- [ ] **Encrypt & sign** · `start.encrypt-sign` · Help: *Set a password and permissions*
- [ ] **Export anywhere** · `start.export` · Help: *Use the start screen*

## Status bar

- [ ] **First page** · `view.page-first` · Help: *Move between pages*
- [ ] **Next page** · `view.page-next` · Help: *Move between pages*
- [ ] **Show or hide the Float bar** · `view.toggle-quick-toolbar` · Help: *Read the status bar*
- [ ] **Last page** · `view.page-last` · Help: *Move between pages*
- [ ] **Previous page** · `view.page-previous` · Help: *Move between pages*

## Command palette and keyboard only

- [ ] **Move selection down** · `annotate.nudge-down` · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection down** · `annotate.nudge-down-far` · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection left** · `annotate.nudge-left` · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection left** · `annotate.nudge-left-far` · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection right** · `annotate.nudge-right` · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection right** · `annotate.nudge-right-far` · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection up** · `annotate.nudge-up` · Help: *Select, move, resize and delete annotations*
- [ ] **Move selection up** · `annotate.nudge-up-far` · Help: *Select, move, resize and delete annotations*
- [ ] **Select every comment on this page** · `annotate.select-all`
- [ ] **Back** · `view.go-back` · Help: *Move between pages*
- [ ] **Forward** · `view.go-forward` · Help: *Move between pages*
- [ ] **Leave Focus** · `view.leave-focus` · Help: *Choose a layout: Ribbon, Studio or Focus*
- [ ] **Move to the next pane** · `view.next-pane`
- [ ] **Move to the previous pane** · `view.previous-pane`
