---
id: read-handwriting
title: Read handwriting with Azure or Claude
summary: Draw a box around handwriting and have Azure Document Intelligence or Claude read it.
keywords: [handwriting, handwritten, azure ocr, claude ocr, read handwriting, cursive, notes, document intelligence, anthropic]
commands: [tools.cloud-region, annotate.claude-region]
contexts: [dialog.ocr, tools]
---
Monstera's built-in text recognition reads printed text. For handwriting, you can send a box you draw to Azure Document Intelligence or to Claude, using your own key. The words come back as searchable, selectable text in the right place.

## Steps

1. Add a key first. See "Get and add keys for AI and online reading services". The provider bills you directly for what you send.
2. In the rail, choose **Tools**. In the **OCR** group, choose **Azure OCR** (**Send a box to Azure to recognise**) or **Claude OCR** (**Send a box to Claude to recognise**).
3. Drag a box around the handwriting. Only the area inside the box is sent.

![The OCR group with Azure OCR and Claude OCR, and a box drawn around handwriting](screenshot:read-handwriting-1)

To read a whole handwritten document without drawing boxes, use **Export to Word** or **Export tables to Excel**, and choose **Handwritten or scanned**. Every page you choose is sent, and the window says how many before you go on.

## Good to know

- **Azure OCR** appears only when both the Azure Document Intelligence endpoint and key are stored (**Settings**, **OCR** page). **Claude OCR** appears only when an Anthropic key is stored (**Settings**, **AI** page).
- Azure deletes its copy of each area after reading it.
- If the key is missing or not accepted, or the service is busy, Monstera says so and nothing is changed.
- If your Anthropic account is out of credit, Monstera tells you to add credit in the Claude Console.
- Undo with **Ctrl+Z**.

<!--
Screenshots to capture:
1. read-handwriting-1 — Tools section with both keys stored, Claude OCR active, a box around a handwritten note on a scan. Frame the OCR group and the box.
-->
