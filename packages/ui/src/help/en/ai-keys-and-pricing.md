---
id: ai-keys-and-pricing
title: Get and add keys for AI and online reading services
summary: How to get an Azure or Anthropic (Claude) key, where to paste it in Monstera, and where to read each provider's own prices.
keywords: [api key, key, azure, document intelligence, azure openai, anthropic, claude, openai, gemini, mistral, xai, grok, openrouter, groq, perplexity, deepseek, pricing, cost, billing, credit, handwriting, ai setup, provider, account]
commands: [ai.setup, app.settings, annotate.claude-region, tools.cloud-region, ai.open-assistant]
contexts: [dialog.ai-setup, dialog.settings, context-panel.assistant]
outside: [Settings → API keys, Create key, Create a resource, Document Intelligence, Go to resource, Keys and Endpoint, API Keys]
---
Some parts of Monstera use an online service that you choose and pay for yourself: the AI assistant, translating a page, reading handwriting in a box you draw, and reading tables from scanned pages. Monstera never sells these services and never adds a charge of its own. You create an account with the provider, create a key there, and paste the key into Monstera. The provider then bills you directly, under its own prices and terms. Everything else in Monstera works without any key.

## Steps

### Get an Anthropic (Claude) key

Claude can answer questions in the assistant, translate a page, read handwriting in a box, and read tables for Excel export.

1. Go to the Claude Console at <https://platform.claude.com> and sign in, or create an account.
2. Set up billing in the Console. Anthropic's own pricing is at <https://claude.com/pricing> and in more detail at <https://platform.claude.com/docs/en/about-claude/pricing>.
3. Open **Settings → API keys** at <https://platform.claude.com/settings/keys> and choose **Create key**. Anthropic's step-by-step guide is at <https://platform.claude.com/docs/en/get-api-key>.
4. Copy the key straight away. Anthropic shows it only once.

### Get an Azure Document Intelligence key and endpoint

Azure Document Intelligence reads handwriting in a box you draw, and tables for Excel export. It needs two things: a key and an endpoint (the address of your own Azure resource).

1. Sign in to the Azure portal at <https://portal.azure.com>. You need an Azure subscription.
2. Choose **Create a resource**, search for **Document Intelligence**, and choose **Create**. Pick a pricing tier. Microsoft's guide is at <https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/create-document-intelligence-resource>.
3. When the resource is ready, choose **Go to resource**, then **Keys and Endpoint**. Copy one of the keys and the endpoint.
4. Microsoft's own pricing for this service is at <https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/>.

### Get an Azure OpenAI key and endpoint

Azure OpenAI is one of the providers the AI assistant can use.

1. In the Azure portal, choose **Create a resource**, search for **Azure OpenAI**, and create it. Microsoft's guide, which also shows how to deploy a model, is at <https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/create-resource>.
2. Copy the resource's key and endpoint.
3. Microsoft's pricing for Azure OpenAI is at <https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/>.

### Paste a key into Monstera

1. Open **Settings**: in the rail, choose **Settings**, or in the rail choose **Tools**, then **Settings** in the **Application** group.
2. For **Claude** or **Azure OpenAI** (and the other assistant providers): choose the **AI** page. In **AI provider**, pick the provider, then paste the key into its key field, for example **Anthropic API key** or **Azure OpenAI key**. For Azure OpenAI, also fill in **Azure OpenAI endpoint**. The provider you pick here is also the one the assistant asks. Under **AI model**, choose the model; the line beneath it says whether the list came from the provider this session or is Monstera's own.
3. To make sure an assistant key works, choose **Check** under its key field. Monstera asks the provider with the stored key and says **Key works**, or says why not: the key was not accepted, the provider could not be reached, or it refused. A key that works also fills **AI model** with the provider's own list. The answer stays until you change the key.
4. For Azure Document Intelligence: choose the **OCR** page and fill in both **Azure Document Intelligence endpoint** and **Azure Document Intelligence key**.
5. Changes save as you make them. Choose **Done** to close Settings.

![The Settings window on the AI page, with AI provider set to Anthropic and the Anthropic API key field showing that a key is stored](screenshot:ai-keys-and-pricing-1)

You can also add an assistant key with a check first: in the rail choose **Review**, then **Set up AI…** in the **AI** group. Pick a **Provider**, paste the **API key**, and choose **Check and save**. Monstera asks the provider whether it accepts the key and stores it only if it does. **Skip** closes the window without storing anything.

![The Set up the AI assistant window with a provider chosen and the Check and save and Skip buttons](screenshot:ai-keys-and-pricing-2)

## Other AI providers

The assistant can use any of these providers. Each needs its own key, pasted on the **AI** page of Settings after choosing it in **AI provider**. Pricing is set by each provider; follow their own pages. Links were checked on 2026-09-26.

| Provider | Where to create a key | Provider's pricing |
|---|---|---|
| OpenAI | <https://platform.openai.com/api-keys> (quick start: <https://developers.openai.com/api/docs/quickstart>) | <https://developers.openai.com/api/docs/pricing> |
| Google Gemini | <https://aistudio.google.com/apikey> | <https://ai.google.dev/gemini-api/docs/pricing> |
| Mistral | <https://console.mistral.ai> | <https://docs.mistral.ai/inference/pricing> |
| xAI | <https://console.x.ai> (the **API Keys** page) | <https://docs.x.ai/docs/models> |
| OpenRouter | <https://openrouter.ai/keys> | <https://openrouter.ai/models> |
| Groq | <https://console.groq.com/keys> | <https://console.groq.com/docs/models> |
| Perplexity | <https://console.perplexity.ai/project/keys> | <https://docs.perplexity.ai/getting-started/pricing> |
| DeepSeek | <https://platform.deepseek.com/api_keys> | <https://api-docs.deepseek.com/quick_start/pricing> |

## Good to know

- You pay the provider directly. Monstera does not charge for, resell or estimate the cost of any provider. Check the provider's own pricing page before you use a service, and set spending limits in your provider account if it offers them.
- Key fields are write-only. After you save a key, Settings shows only that a key is stored. To change it, type a new one over it; to delete it, choose the red **Remove the stored key** button beside **Check** and confirm with **Remove it**.
- Keys are kept in the Windows credential vault. They are never included in **Export settings…** and never written to the diagnostics log. If this computer has no secure place for a key, Monstera says so and does not save it.
- Nothing from your document is sent until you ask: the assistant sends only when you press **Send**, and the reading and translating windows say what will be sent before you confirm.
- The **Azure OCR** and **Claude OCR** buttons in the **OCR** group of **Tools** appear only once the matching key (and, for Azure, the endpoint) is stored.
- If you see "Your Anthropic account is out of credit — add credit at console.anthropic.com", add credit in the Claude Console (console.anthropic.com now opens platform.claude.com).
- The provider links above were checked on 2026-09-26. Providers change their sites; if a link has moved, search the provider's site for "API keys" or "pricing".

<!--
Screenshots to capture:
1. ai-keys-and-pricing-1 — Settings dialog (dialog.settings), AI page selected. State: an Anthropic key already stored. Frame the AI provider dropdown and the "Anthropic API key" row showing "A key is stored. Type a new one to replace it." and "Remove the stored key".
2. ai-keys-and-pricing-2 — "Set up the AI assistant" dialog (dialog.ai-setup), opened from Review › AI › Set up AI…. State: Provider = Azure OpenAI so the "Azure OpenAI endpoint" field shows; key field empty. Frame the whole dialog including "Check and save" and "Skip".
-->
