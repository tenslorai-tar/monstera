---
id: set-up-ai
title: Set up the AI assistant
summary: Choose a provider, paste your key, and let Monstera check it before saving, or skip.
keywords: [set up ai, onboarding, first run, add key, provider, check key, skip ai]
commands: [ai.setup]
contexts: [dialog.ai-setup, review]
---
The first time you start Monstera, it offers to set up the AI assistant. You can do it then, later, or never; everything else works without it.

## Steps

1. In the rail, choose **Review**, then **Set up AI…** in the **AI** group (or accept the offer when Monstera starts).
2. Choose a **Provider**.
3. Paste your **API key**. For Azure OpenAI, also fill in **Azure OpenAI endpoint**.
4. Choose **Check and save**. Monstera asks the provider whether the key works and saves it only if it does.
5. Or choose **Skip**.

![The Set up the AI assistant window](screenshot:set-up-ai-1)

## Good to know

- A key the provider refuses is not saved, and any key you had stored before is kept.
- To stop the offer at start-up, turn off **Offer AI setup when Monstera starts** in **Settings**, **AI** page. Skipping or saving a key also turns it off.
- Where to get a key and each provider's pricing: see "Get and add keys for AI and online reading services".
- If this computer has no secure place for a key, the window says so and does not save one.

<!--
Screenshots to capture:
1. set-up-ai-1 — dialog.ai-setup with Anthropic selected and a key pasted (masked). Frame the dialog.
-->
