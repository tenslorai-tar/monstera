---
id: ai-assistant
title: Ask the AI assistant about a document
summary: Chat with an AI provider of your choice about the page, the whole document, selected text or the comments.
keywords: [ai, assistant, chat, ask, question, summarise, claude, openai, gemini, explain, answer, copilot, web search]
commands: [ai.open-assistant]
contexts: [context-panel.assistant, review]
---
The AI assistant answers questions about your document using an AI provider you choose, with your own key. It sends only what you choose, and only when you press **Send**.

## Steps

1. Add a key for a provider first. See "Get and add keys for AI and online reading services".
2. In the rail, choose **Review**, then **Open the AI assistant** in the **AI** group, or press **Ctrl+Shift+A**. The **AI assistant** tab opens in the right-hand panel.
3. Choose the **Provider** and **Model**, in the two boxes under the message box. Whatever the provider box shows is where your next message goes.
4. In the **Choose** row above the message box, open **Context** and choose what to send: this page, the whole document, the comments, a picture of this page, your selection, or **None**. With two or more documents open, **All Open Docs** sends every one.
5. Open **Sources** and choose **Document only** or **Document + web**. Nothing is sent until you press **Send**.
6. Type your question in the box that says **Ask about this page…** and press **Enter** to send (**Shift+Enter** starts a new line).
7. To ask about a file you have not opened, choose **Attach files**, the paperclip, and pick up to eight files of any kind. Each shows above the box, with an **x** to take it off.
8. Choose **Go to page …** in an answer to jump to the page it cites. An answer that names none of the document's pages says **No page cited — check this against the document.**

![The AI assistant tab with Provider, Model, Context and an answer citing a page](screenshot:ai-assistant-1)

## Good to know

- A page an answer names in any usual way, such as "[p. 3]", "[Page 3]", "(pp. 3–4)" or "on page 3", is a link.
- Under an answer you can **Regenerate this answer**, **Edit your question and ask again**, **Copy this answer**, or **Add this answer to the page as a note**. **Stop** ends an answer early; **New chat**, the **+** at the top right, starts over.
- **Save chat history** is on unless you turn it off (**Settings**, **AI** page). Chats about each file are kept on this computer, encrypted for your Windows account, with no limit on how many. The first time you open the AI assistant, a note says so. If you turned it off yourself, it stays off. Opening a file does not bring a chat back into the AI assistant; its saved chats are in **History**.
- Saved chats belong to the file where it is. If the file is moved, renamed or deleted, its chats are removed about a day after Monstera notices. Saving the file in Monstera keeps them.
- Choose **History** at the top of the AI assistant to see the saved chats about this file, newest first, each with when it was saved, how many messages it has and its first question. **Open** shows a chat to read. **Delete** removes one chat and **Clear all** removes every chat about this file, each after asking.
- To remove every saved chat for every file, choose **Clear chat history** on the **Privacy** page of **Settings**. It asks first.
- If this Windows account can no longer open the chats saved on this computer, for example after an administrator reset its password, the AI assistant says chat history cannot be saved. Nothing saved is removed. **Clear chat history** starts again.
- If the provider says a conversation has grown too long for its model, the AI assistant says so and offers **Start a new conversation**.
- With **Document + web**, your question, and possibly text from the document, goes to a search engine through the provider you chose, and searches may cost extra. Every new chat starts with **Document only**.
- With **All Open Docs**, the documents open when you press **Send** go, the one you are in first, and they share one limit equally. The line under your question says how much of each could go, what went from each, and any document that could not be read and why. Each answer cites a document and a page, for example "Doc 2 p. 3"; choose it to go to that page, while that document is still open. At most 16 documents go; the line names any past that.
- **Attached files** are read on this computer before anything is sent: a PDF's text, a Word, Excel or PowerPoint file's text, a text file, and a JPEG or PNG picture, which goes as a picture to a model that can read one. The line under your question says what went from each file and names any file that could not be read, and why; the question still goes. An answer cites a file as, for example, "File 2 p. 3". Text from your documents and files shares one limit equally.
- AI can make mistakes. Double check replies. The AI assistant says so under its model choice.
- The provider bills you directly for what you send. If a model cannot read pictures, sending a picture is not offered.
- If the key is not accepted or the provider cannot be reached, the AI assistant says so. What you typed is kept.

<!--
Screenshots to capture:
1. ai-assistant-1 — AI assistant tab with Anthropic and a model chosen, Context on "Page 3", a question and an answer with a "Go to page 3" link. Frame the right panel.
-->
