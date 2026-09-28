---
id: if-something-goes-wrong
title: If something goes wrong
summary: What Monstera's problem messages mean, how to try again, and where to find the diagnostics log.
keywords: [error, problem, crash, try again, not working, diagnostics, log, support, bug report, something went wrong]
commands: [log.reveal]
contexts: [dialog.command-problem, dialog.save-problem, tools]
---
When something cannot be done, Monstera tells you in plain words and says what happened to your document. In almost every case your document is unchanged.

## Steps

1. Read the message. It says whether anything changed and what you can do next, for example "Try again in a moment" or "Close another document first".
2. If a view shows **This document could not be displayed.**, choose **Try again**. Your file is unchanged and you return to the same page.
3. If part of the window stops working, choose **Try again** to redraw it. Your open documents are unchanged.
4. If you need to report a problem, open the diagnostics log: in the rail choose **Tools**, then **Diagnostics** in the **Application** group (or **Diagnostics** at the foot of the start screen). The folder with the log files opens in File Explorer.

![A problem message with the Try again button](screenshot:if-something-goes-wrong-1)

## Good to know

- A message may show a **Reference** code. Include it if you report the problem.
- The log records problems. To report something slow or unexpected, open **Settings**, choose **Advanced**, set **Diagnostics log** to **Detailed**, and do it again: the log then also records each thing Monstera was asked to do and how long it took. It never records names, text or where your files are.
- If Monstera says it can no longer work on a document, your changes are still open: save them somewhere else with **Save a copy…**, or close and reopen the file.
- Messages that appear briefly at the bottom of the window can be dismissed with **Dismiss**, and they pause while you point at them.

<!--
Screenshots to capture:
1. if-something-goes-wrong-1 — Hard to trigger on purpose; use a development build to show the view problem panel ("This document could not be displayed." with Try again). Frame the panel.
-->
