
'use server';

/**
 * @fileOverview This file defines a function for a customer FAQ chatbot.
 *
 * - `customerFAQChatbot` - A function that processes customer questions and returns answers.
 * - `CustomerFAQChatbotInput` - The input type for the `customerFAQChatbot` function.
 * - `CustomerFAQChatbotOutput` - The return type for the `customerFAQChatbot` function.
 */

import { z } from 'zod';
import axios from 'axios';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const CustomerFAQChatbotInputSchema = z.object({
  question: z
    .string()
    .describe('The customer support question. Be specific about order delays due to redeem code processing.'),
  history: z.array(MessageSchema).optional().describe('The previous conversation history.'),
  gamingId: z.string().optional().describe("The user's real Gaming ID."),
  visualGamingId: z.string().optional().describe("The user's display-only Gaming ID."),
  mediaDataUri: z.string().optional().describe(
    "An optional photo provided by the user, as a data URI. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
  ),
});
export type CustomerFAQChatbotInput = z.infer<typeof CustomerFAQChatbotInputSchema>;

const CustomerFAQChatbotOutputSchema = z.object({
  answer: z.string().describe('The answer to the customer support question.'),
});
export type CustomerFAQChatbotOutput = z.infer<typeof CustomerFAQChatbotOutputSchema>;

// This is the prompt template that was previously inside the Genkit prompt.
const PROMPT_TEMPLATE = `You are the official customer support chatbot for Garena Store (Free Fire). Your goal is to be a polite, trusted, and professional assistant.
Your final response MUST be a JSON object with a single key "answer". Provide your response inside a JSON code block. Example: \`\`\`json\n{\n  "answer": "Your detailed answer here."\n}\n\`\`\`
CORE RULES:
Media Analysis: You MUST analyze any image a user provides. This is critical for understanding their problem.
Proactive Media Request: If a user describes a problem (like an error, payment issue, or something not appearing right), you SHOULD proactively ask them to provide a screenshot. This is your primary way of gathering more information.
Order Image Analysis: If a user sends an image of their order history:
1.  Examine the image to identify the order's date, time, and status (e.g., 'Processing', 'Completed').
2.  If the status is 'Processing', you MUST tell the user to double-check that their Gaming ID is correct on the order page. Also, ask them to check their in-app notifications for any updates and to send a screenshot of the notification if they have one.
Language Matching: You MUST detect the user's language and writing style and match it precisely.
- If the user writes in English, reply in English.
- If the user writes in pure Hindi (Devanagari script), reply in pure Hindi (Devanagari script).
- If the user writes in Hinglish (Hindi words with Roman characters, e.g., "kese kuch lu idhar se"), you MUST reply in Hinglish (e.g., "Aap ese topup kar sakte ho"). Do not switch to pure Hindi script.
- Apply this logic for all other languages and their mixed-script variants like bengali, malayalam, telegu etc any language in the world you have to talk the lanuguage the user talking.
Knowledge Base: Answer only using the provided About Us, Terms & Conditions, and Privacy Policy. Do not make up information.
Unanswerable Questions: If you cannot answer, direct them to the Support Page for 24/7 support. support page url https://www.garenafreefire.store/support .  Politely remind them to be respectful and professional in their communication to ensure the best assistance.
Nonsensical/Unrelated Questions: If the user's message has no clear meaning or is completely unrelated to Garena, Free Fire, or the store, politely state that you can only answer questions about the game and the Garena Store and cannot understand their message.
Server: You are currently serving the Indian server.
PRIVACY & ID RULES:
ID Display: If a 'visualGamingId' is provided, you MUST use ONLY that ID. Treat it as the user's one and only Gaming ID. You must NEVER reveal the real 'gamingId' or mention the concept of a 'visualGamingId'. This is a secret internal concept.
ID Usage: Do NOT mention the user's Gaming ID unless it is directly relevant to their question or you are asking them to confirm it.
ID Changes: If asked why an ID changed, or if a user says they entered the wrong ID, Then try to understand user IDs do not change automatically. You likely entered the wrong ID. Please logout, then register again with your correct ID. You will then be able to purchase items normally.
Logging: Inform users that messages are saved for support review.
SCENARIO ANSWERS
Login History: Instruct to go to Privacy Policy page, scroll to bottom, and click "View Login History".
App Install: Instruct to open the top menu on their mobile device and tap "Download App".
Rewards: Users must watch the entire ad to get coins.
Email Response: Standard time is 32 working hours. If worried, they can resend the email. Waiting for a response does not affect your ability to purchase items on the site.
Refunds: No official max time, but usually processed within 14 days.
Unauthorized/Expired Purchases: This violates T&C. Item will not be delivered; account may be suspended.
Bug Exploitation: If a user finds a bug and uses it for their own benefit, it will result in "Access Denied." Access is very unlikely to be restored. For a banned ID, there is a possibility of recovery; contact support for this.
Bug Reports: If a user reports a bug, thank them and ask them to email details, their Gaming ID, phone number, and a screenshot to support. Mention that genuine reports may be rewarded.
Item Details: If a user asks about a specific gaming item's features, abilities, or in-game use, tell them to check the product details on the item's page for the most accurate information.
Blank/Missing Products: The product is being updated. Ask them to wait a moment and check back.
New Event Items: Can take up to 2 days to appear. Not all in-game items are sold here.
Access Denied/Spamming: If a user opens the payment page many times without paying, it can lead to "Access Denied." State that this is a serious violation and recovery is very unlikely.
Free Redeem Codes: State that Garena Store is a retail platform and does not provide free redeem codes. All codes must be purchased.
Free Diamonds/Items: If a user asks for free diamonds or other items, tell them to check the store's product list. If any item is available for free, they can get it there. Otherwise, clarify that all items are available at a discounted price but are not given away.
PAYMENT & TECHNICAL:
Payment Confirmation Time: UPI payments are confirmed almost immediately, usually within 10 seconds. The order is placed right after confirmation.
Server Selection: If a user asks how to change the server, state that it is automatically detected by their IP address and cannot be changed manually.
Processing Fee: A small fee is added during high traffic to ensure UPI payments work quickly.
UPI Name: If a user mentions seeing "Sayan Mondal" in the UPI app during payment, you can reassure them that it is an official payment executive's account and is completely safe to pay. You should not bring this name up proactively.
UPI Errors: If the UPI app shows any error after scanning the QR code, instruct the user to contact the support team immediately at garenaffmaxstore@gmail.com with their Gaming ID and phone number.
Payment Debited, Order Not Received: If a user's money was debited but the item was not delivered or the order failed, instruct them to contact the support team at garenaffmaxstore@gmail.com with their Gaming ID, phone number, and transaction details.
Paying on Same Device: Instruct to Screenshot the QR code -> Open UPI App -> Select "Scan from Gallery".
Other Games (PUBG/BGMI): State you only support Garena Free Fire.
Important - when you telling users to contact support do not mention the users gaming id you just can tell to send gaming id but don't tell him the number of id.
Important - If user sent a scanner where in the scanner if garena not mention or after analyzing if the QR code was not Sayan's then its not garena stores payment QR code.
Website/Ads Info: Website made by Garena (Free Fire division). Garena selects the ad providers.
---
**User Information:**
- Gaming ID: {GAMING_ID}
---

**Conversation History:**
{HISTORY}
---

🧠 Website Context (Garena Free Fire Shop)

Overview:
Garena is the official online shop for Free Fire players, headquartered in Singapore with offices worldwide. The official website is https://www.garenafreefire.store. It offers secure, discounted in-game purchases, funded by ads shown on the website.

⚡ Core Features

Official & Trusted: 100% safe, verified items.
Flexible Payments: Pay via UPI or ask support about Redeem Codes (email: garenaffmaxstore@gmail.com).
Coin System:
5000 coins on first registration.
5 coins for each ad watched.
Coins auto-apply for discounts at checkout.
Coins can be transferred to friends.
🛒 How It Works
1.  **Choose a Product:** Browse the items and click the "Buy" button on the one you want.
2.  **Start Payment:** In the purchase pop-up, click the "Pay via UPI" button.
3.  **Scan and Pay:** A QR code will appear. Scan this code with any UPI app (like Google Pay, PhonePe, Paytm, etc.) to complete the payment.
4.  **Automatic Verification:** After you pay, your purchase is automatically verified by our system. You don't need to do anything else.
5.  **Track Orders:** You can track all your orders on the “Orders” page.

Request refunds via the “Orders” page (subject to review).

⚙️ Terms & Privacy Summary
Refund Policy: Reviewed manually; fraudulent requests are denied.
Privacy: Collects name, email, and game ID to process orders, manage accounts, and provide support.
Advertising: Discounts are funded through ads displayed to users.
Security: Technical and administrative protection for user data.
Login History: Users can view previous Gaming IDs on the Privacy Policy page.
📨 Support
For help or to inquire about redeem code payments, contact:
https://www.garenafreefire.store/support or -
📧 garenaffmaxstore@gmail.com

Importent things
If a user says that he purchase store coin but the item not goes to his gameing account then tell him that store coin not sended to gaming account its only used in Garena Store for discount when he purchase other items then it sended to their gaming account.
If someone says how and where the purchased item goes into their game tell them that purchase item goes to in game mail box and they can claim item from there.
If someone put wrong UID or want to logout then tell him to click 3 underline at the top right corner and then click logout after logout they can again login.
If someone says after logout and login again he can't see orders tell him that after logout you might login with other UID thats why you can't see any order for checking your previous login UID he can click on 3 underline(≡) at the top right corner and click on privacy policy page and scroll down to bottom and click on login history button to see which UID he logged in prevously.
always try to tell user whenever its looks perfect to download the app for better performance and for sownload they can click on 3 underline(≡) at top right corner and click on download button.
When a user tell can I purchase a item usin only coins tell him no. Maximum coin and minimum price are fixed for every product and eny user can see it on product list, if a user says he get more price during payment then tell him that he might have enogh coin thats why when try to buy payment incresed. when they try to pay they can't chnage coin applying its automatically applied the best possible discount as per the rules I prevouly mentioned.
If user says how to check his UID tell him please click on buy button on any product then he can see his logged in UID in product detailspage.
If users needs any help tell them to prefer ask help thorugh https://www.garenafreefire.store/support and if they ask support thorgh mail then its can be late more.
in support page they can create a report and when send a chatbox open and a report was created later they can check the report when garena support team reply maximum reply time 32 working hours.
in support page users can sent maximum 10 mb photos, videos, or files like audio-pdf etc at once.
If a user can't able to make report then he was blocked for violation tell him to mail.
If a user demand for customer care number or how to talk directly then tell user go to https://www.garenafreefire.store/support page and create report and look at the top right corner call icon click on it then a popup appears click yes to callback request when they do it support team gets call back request and they soon provide a calling link if the user is eligible for getting call otherwise he can talk in chat.
If a users refund request was accecpted then they can check it by going order page a flowting box appear when they click on it they can see there refund status.
When user make refund request they have to fill all required filed and then when they click on submit a report was created and then can this report using https://www.garenafreefire.store/support this page. old refund request that opens email are no more supported.
Always try to tell users if they need any support please make a report on https://www.garenafreefire.store/support this page click on cretae report button describe the issiuse and click create report it will open a chat windows where a support team member will reply within 32 working hours. avoide telling about email until its necessary.
---

Now, please answer the following user question based on the conversation history and provided context:
"{QUESTION}"
`;

/** Gemini model used for every answer (also named in the server log lines). */
const MODEL = 'gemini-3.1-flash-lite';

/**
 * Retry policy. Google sometimes answers "503 This model is currently
 * experiencing high demand" for a few seconds. Such an attempt is repeated
 * once on the same model, so the user only sees the usual typing indicator a
 * little longer. The delay is short on purpose: a 503 or 429 comes back fast,
 * and a live chat cannot afford long waits. When the retry fails as well, the
 * fallback model below answers instead of giving up.
 */
const MAX_ATTEMPTS = 2;
const RETRY_DELAYS_MS = [1000]; // before attempt 2
const REQUEST_TIMEOUT_MS = 60_000; // big screenshots sometimes need more than 30 s; a hung attempt must still not block the fallback

/**
 * Fallback model, used only after every Gemini attempt failed. It runs on
 * Cloudflare Workers AI, a separate provider, so a Google-side overload no
 * longer leaves the user without an answer. It needs CLOUDFLARE_AI_ACCOUNT_ID
 * and CLOUDFLARE_AI_API_TOKEN in the runtime environment (never NEXT_PUBLIC_).
 * When either is missing the fallback is skipped and this file behaves exactly
 * as it did before.
 */
const FALLBACK_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const FALLBACK_TIMEOUT_MS = 45_000;
/** Answers are a few sentences; this only stops a runaway reply. */
const FALLBACK_MAX_TOKENS = 1024;
/** Hard cap on a fallback answer, which may arrive as plain text. */
const FALLBACK_MAX_ANSWER_CHARS = 6000;
/** Sent as the system message so the fallback model treats the prompt above exactly like Gemini does. */
const FALLBACK_SYSTEM_PROMPT =
  'You are the customer support chatbot described in the user message. Follow every rule in it exactly, ' +
  'including the language rule and the response format: reply with only the JSON object it asks for, ' +
  'inside a ```json code block, and nothing else.';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whether a failed attempt is worth repeating. Overload (503), rate limiting
 * (429), other 5xx, timeouts and connection errors are temporary. A 400, 401,
 * 403 or 404 means the request itself (key, model name, payload) is wrong and
 * would fail identically again, so those stop at once. A reply that is not in
 * the expected JSON shape is also retried: a fresh generation usually fixes it.
 * Whatever the reason, once the attempts are used up the fallback model is asked.
 */
function isRetryableError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === undefined) return true; // timeout or connection problem
    return status === 408 || status === 429 || status >= 500;
  }
  return true;
}

/**
 * Short description of a failed attempt for the server log. Never the URL
 * (Google's carries the key) and never the request headers (Cloudflare's carry
 * the token): only the status and the provider's message.
 */
function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === undefined) {
      return error.code === 'ECONNABORTED'
        ? `no response within ${error.config?.timeout ?? '?'}ms`
        : `connection error (${error.code ?? error.message})`;
    }
    // Google answers { error: { status, message } }, Cloudflare { errors: [{ code, message }] }.
    const data = error.response?.data as
      | { error?: { status?: string; message?: string }; errors?: { code?: number; message?: string }[] }
      | undefined;
    return [`HTTP ${status}`, data?.error?.status, data?.error?.message, data?.errors?.[0]?.message]
      .filter(Boolean)
      .join(' ');
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The reply Gemini is asked for: a ```json block holding {"answer": "..."}.
 * Anything else counts as a failed attempt (unchanged behaviour).
 */
function parseStrictAnswer(responseText: string): CustomerFAQChatbotOutput {
  const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch || !jsonMatch[1]) {
    console.error("Could not find JSON in AI response:", responseText);
    throw new Error('AI response did not contain a valid JSON block.');
  }
  const parsedResponse = JSON.parse(jsonMatch[1]);

  const validation = CustomerFAQChatbotOutputSchema.safeParse(parsedResponse);
  if (!validation.success) {
    console.error("AI response validation error:", validation.error);
    throw new Error('Received an invalid response format from the AI model.');
  }
  return validation.data;
}

/** Trims a fallback answer and cuts it at the hard cap. */
function capAnswer(answer: string): string {
  const trimmed = answer.trim();
  return trimmed.length > FALLBACK_MAX_ANSWER_CHARS ? `${trimmed.slice(0, FALLBACK_MAX_ANSWER_CHARS)}…` : trimmed;
}

/** Undoes JSON string escapes ("\n", "\"", "\\") in text that was cut out of a JSON literal. */
function unescapeJsonString(literalBody: string): string {
  try {
    const parsed = JSON.parse(`"${literalBody}"`);
    return typeof parsed === 'string' ? parsed : literalBody;
  } catch {
    return literalBody.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

/**
 * The fallback model is not guaranteed to honour the JSON instruction, so its
 * reply is accepted in this order: the ```json block, a bare JSON object, the
 * "answer" value of a JSON object that is otherwise broken or cut off, and
 * finally the whole text. Whatever the shape, the result is only ever a string:
 * it is validated, trimmed and capped here, stored as text by askQuestion() and
 * rendered as text by React, so nothing in it can run. An empty reply fails.
 */
function parseLenientAnswer(responseText: string): CustomerFAQChatbotOutput {
  const text = responseText.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  for (const candidate of [fenced, text]) {
    if (!candidate) continue;
    try {
      const validation = CustomerFAQChatbotOutputSchema.safeParse(JSON.parse(candidate));
      if (validation.success && validation.data.answer.trim()) {
        return { answer: capAnswer(validation.data.answer) };
      }
    } catch {
      // Not JSON: try the next shape.
    }
  }

  const answerKey = text.match(/"answer"\s*:\s*"/);
  if (answerKey && answerKey.index !== undefined) {
    const rest = text.slice(answerKey.index + answerKey[0].length);
    // A complete string literal when the closing quote is there; otherwise the
    // reply was cut off, so take what is there minus a trailing code fence.
    const literalBody = rest.match(/^((?:[^"\\]|\\.)*)"/)?.[1] ?? rest.replace(/\s*```\s*$/, '');
    const answer = unescapeJsonString(literalBody);
    if (answer.trim()) return { answer: capAnswer(answer) };
  }

  const plain = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!plain) throw new Error('Fallback model returned an empty answer.');
  return { answer: capAnswer(plain) };
}

/** The fallback configuration from the environment, or null when it is not set up. */
function fallbackConfig(): { accountId: string; apiToken: string } | null {
  const accountId = (process.env.CLOUDFLARE_AI_ACCOUNT_ID ?? '').trim();
  const apiToken = (process.env.CLOUDFLARE_AI_API_TOKEN ?? '').trim();
  return accountId && apiToken ? { accountId, apiToken } : null;
}

/**
 * Asks the fallback model the very same prompt. The prompt is the user message;
 * the screenshot, if any, travels with it as an OpenAI-style image part, which
 * is how Workers AI accepts data URIs. The model's reasoning mode is switched
 * off on purpose: with it on, the whole token budget goes to hidden reasoning
 * and the answer never arrives. The token is sent in a header, never in the URL.
 */
async function askFallbackModel(
  config: { accountId: string; apiToken: string },
  fullPrompt: string,
  mediaDataUri?: string
): Promise<CustomerFAQChatbotOutput> {
  const userContent = mediaDataUri
    ? [
        { type: 'text', text: fullPrompt },
        { type: 'image_url', image_url: { url: mediaDataUri } },
      ]
    : fullPrompt;

  const response = await axios.post(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/v1/chat/completions`,
    {
      model: FALLBACK_MODEL,
      messages: [
        { role: 'system', content: FALLBACK_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: FALLBACK_MAX_TOKENS,
      chat_template_kwargs: { enable_thinking: false },
    },
    {
      headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
      timeout: FALLBACK_TIMEOUT_MS,
    }
  );

  const text = response.data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Fallback model returned no text.');
  }
  return parseLenientAnswer(text);
}

/**
 * Calls the Google AI API directly to get an answer to a customer question.
 * @param input The customer's question and context.
 * @returns The answer from the AI model.
 */
export async function customerFAQChatbot(input: CustomerFAQChatbotInput): Promise<CustomerFAQChatbotOutput> {
  const { question, history, gamingId, visualGamingId, mediaDataUri } = input;

  // 1. Construct the history string
  const historyString = history
    ? history.map(h => `**${h.role}**: ${h.content}`).join('\n')
    : 'No previous conversation history.';

  // 2. Construct the full prompt by replacing placeholders
  let fullPrompt = PROMPT_TEMPLATE
    .replace('{GAMING_ID}', visualGamingId || gamingId || 'Not provided')
    .replace('{HISTORY}', historyString)
    .replace('{QUESTION}', question);

  // Define the parts for the API request
  const parts: any[] = [{ text: fullPrompt }];

  // Add media if it exists
  if (mediaDataUri) {
    const [header, base64Data] = mediaDataUri.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: base64Data,
      },
    });
  }

  // 3. Define the API endpoint and key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set.');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  // 4. Construct the request payload
  const payload = {
    contents: [{ parts }],
  };

  // 5. Call the API, repeating a transient failure once on the same model (see the retry policy above).
  const fallback = fallbackConfig();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
      });

      // 6. Extract the text response and parse the JSON block it must contain
      const responseText = response.data.candidates[0].content.parts[0].text;
      const result = parseStrictAnswer(responseText);

      if (attempt > 1) {
        console.log(`[chatbot] ${MODEL} answered on attempt ${attempt}/${MAX_ATTEMPTS}`);
      }
      return result;
    } catch (error) {
      const willRetry = attempt < MAX_ATTEMPTS && isRetryableError(error);
      const delayMs = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      const next = willRetry
        ? ` - retrying in ${delayMs}ms`
        : fallback
          ? ` - falling back to ${FALLBACK_MODEL}`
          : ' - giving up';
      console.error(`[chatbot] ${MODEL} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${describeError(error)}${next}`);
      if (!willRetry) break;
      await sleep(delayMs);
    }
  }

  // 7. Every Gemini attempt failed: hand the same prompt to the fallback model.
  //    If that fails too, the error is the same as before, so askQuestion()
  //    keeps showing the user the usual "unable to answer at the moment" message.
  if (!fallback) {
    console.error('[chatbot] fallback skipped: CLOUDFLARE_AI_ACCOUNT_ID or CLOUDFLARE_AI_API_TOKEN is not set - giving up');
    throw new Error('Failed to get a response from the AI model.');
  }
  try {
    const result = await askFallbackModel(fallback, fullPrompt, mediaDataUri);
    console.log(`[chatbot] ${FALLBACK_MODEL} answered after ${MODEL} failed`);
    return result;
  } catch (error) {
    console.error(`[chatbot] ${FALLBACK_MODEL} failed: ${describeError(error)} - giving up`);
    throw new Error('Failed to get a response from the AI model.');
  }
}
