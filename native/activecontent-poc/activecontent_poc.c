/*
 * activecontent_poc.exe — the CONTROL for invariant 24.
 *
 * Invariant 24 says opening a document runs none of its content. A proof of
 * that is a negative, and a negative is worthless unless something shows the
 * fixture's active content is observable WHEN IT FIRES. That is this program's
 * only job: run the same document through an engine that DOES execute it, with
 * an observer installed, and report what happened.
 *
 * Two modes, differing in exactly one call:
 *
 *   js     fz_open_document -> pdf_specifics -> pdf_enable_js
 *   nojs   fz_open_document -> pdf_specifics
 *
 * `nojs` is what monstera_mupdf.c's mz_open does, call for call. It exists so
 * the difference measured here is the JS engine and not the harness, the
 * fixture, or the build.
 *
 * THE OBSERVER IS INSTALLED IN BOTH MODES. A negative probe whose observer is
 * only present on the positive side cannot tell "did not fire" from "nobody was
 * watching", and this repository has paid for that shape three times. Here the
 * callback is registered before the document is opened far enough to run
 * anything, in both modes, so a silent `nojs` run is a silent engine rather
 * than a silent harness.
 *
 * Document-level JavaScript is executed by pdf_enable_js itself — it calls
 * pdf_js_load_document_level — so the alert arrives during that call and not
 * on some later page render.
 *
 * Output is one line per event plus a final EVENTS= line, which is what the
 * proof reads. Exit 0 means the run completed and the count is meaningful;
 * a non-zero exit means the count is not to be read at all.
 *
 * This file is outside every tsconfig and ESLint rule (CLAUDE.md's native/
 * exception), so the compiler is the only check and the rules live here.
 */

#include <stdio.h>
#include <string.h>

#include "mupdf/fitz.h"
#include "mupdf/pdf.h"

static int g_events = 0;

static const char *event_name(int type)
{
	switch (type) {
	case PDF_DOCUMENT_EVENT_ALERT: return "ALERT";
	case PDF_DOCUMENT_EVENT_PRINT: return "PRINT";
	case PDF_DOCUMENT_EVENT_LAUNCH_URL: return "LAUNCH_URL";
	case PDF_DOCUMENT_EVENT_MAIL_DOC: return "MAIL_DOC";
	case PDF_DOCUMENT_EVENT_SUBMIT: return "SUBMIT";
	case PDF_DOCUMENT_EVENT_EXEC_MENU_ITEM: return "EXEC_MENU_ITEM";
	default: return "UNKNOWN";
	}
}

/*
 * The message is printed, not just counted. A count says something ran; the
 * message says it was OUR fixture's code and not an engine diagnostic that
 * happens to arrive on the same channel.
 */
static void on_doc_event(fz_context *ctx, pdf_document *doc, pdf_doc_event *evt, void *data)
{
	g_events++;

	if (evt->type == PDF_DOCUMENT_EVENT_ALERT) {
		pdf_alert_event *alert = pdf_access_alert_event(ctx, evt);
		printf("EVENT %s %s\n", event_name(evt->type),
		       alert->message == NULL ? "(no message)" : alert->message);
		/* The app is expected to answer an alert. Nothing here reads the
		 * answer, but leaving it unset hands MuPDF an uninitialised choice. */
		alert->button_pressed = 0;
		return;
	}

	printf("EVENT %s\n", event_name(evt->type));
}

int main(int argc, char **argv)
{
	fz_context *ctx;
	fz_document *doc = NULL;
	pdf_document *pdf = NULL;
	int enable_js;

	if (argc != 3 || (strcmp(argv[2], "js") != 0 && strcmp(argv[2], "nojs") != 0)) {
		fprintf(stderr, "usage: activecontent_poc <file.pdf> js|nojs\n");
		return 2;
	}
	enable_js = strcmp(argv[2], "js") == 0;

	ctx = fz_new_context(NULL, NULL, FZ_STORE_DEFAULT);
	if (ctx == NULL) {
		fprintf(stderr, "could not create a MuPDF context\n");
		return 3;
	}

	fz_try(ctx) {
		fz_register_document_handlers(ctx);
		doc = fz_open_document(ctx, argv[1]);
		pdf = pdf_specifics(ctx, doc);
		if (pdf == NULL)
			fz_throw(ctx, FZ_ERROR_GENERIC, "not a PDF");

		/* Installed in BOTH modes, and before the enable below, which is what
		 * makes the nojs run's silence mean something. */
		pdf_set_doc_event_callback(ctx, pdf, on_doc_event, NULL, NULL);

		if (enable_js)
			pdf_enable_js(ctx, pdf);
	}
	fz_catch(ctx) {
		fprintf(stderr, "FAILED %s\n", fz_caught_message(ctx));
		fz_drop_document(ctx, doc);
		fz_drop_context(ctx);
		return 4;
	}

	printf("MODE %s\n", argv[2]);
	printf("EVENTS %d\n", g_events);

	fz_drop_document(ctx, doc);
	fz_drop_context(ctx);
	return 0;
}
