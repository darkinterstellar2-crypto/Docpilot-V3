/**
 * controllers/aiProvider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Swappable AI model abstraction layer.
 * Currently supports: Gemini (default)
 *
 * Uses Node 18+ built-in fetch (no external dependency needed).
 *
 * chat() returns: { text: string, inputTokens: number, outputTokens: number }
 */

class AIProvider {
    constructor(config) {
        this.config = config;
    }

    async chat(systemPrompt, messages, maxTokens = 2048) {
        throw new Error('Not implemented');
    }
}

class GeminiProvider extends AIProvider {
    async chat(systemPrompt, messages, maxTokens = 2048) {
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        const body = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature: 0.7
            }
        };

        const jsonBody = JSON.stringify(body);

        // Retry with backoff + model fallback on 503/429
        const fallbackModels = [this.config.model, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
        let lastError = null;

        for (const model of fallbackModels) {
            for (let attempt = 0; attempt < 2; attempt++) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`;

                try {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: jsonBody
                    });

                    if (res.ok) {
                        const data = await res.json();
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text
                            || "I couldn't generate a response.";
                        const inputTokens  = data.usageMetadata?.promptTokenCount    || 0;
                        const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
                        return { text, inputTokens, outputTokens };
                    }

                    const errBody = await res.text();
                    lastError = `${model}: ${res.status} ${errBody.slice(0, 200)}`;

                    // Only retry on 429 (quota) or 503 (overloaded)
                    if (res.status === 429 || res.status === 503) {
                        // Wait before retry: 2s first attempt, 5s second
                        await new Promise(r => setTimeout(r, attempt === 0 ? 2000 : 5000));
                        continue;
                    }

                    // Other errors (400, 401, etc.) — don't retry, don't fallback
                    throw new Error(`Gemini API error: ${lastError}`);

                } catch (err) {
                    if (err.message?.startsWith('Gemini API error:')) throw err;
                    lastError = `${model}: ${err.message}`;
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            // Model exhausted retries, try next fallback model
        }

        throw new Error(`Gemini API error: all models failed. Last: ${lastError}`);
    }
}

class AnthropicProvider extends AIProvider {
    async chat(systemPrompt, messages, maxTokens = 2048) {
        const model = this.config.model || 'claude-haiku-4-20250414';

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.config.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
            })
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Anthropic API error: ${res.status} ${errBody.slice(0, 200)}`);
        }

        const data = await res.json();
        const text = data.content?.[0]?.text || "I couldn't generate a response.";
        const inputTokens  = data.usage?.input_tokens  || 0;
        const outputTokens = data.usage?.output_tokens || 0;
        return { text, inputTokens, outputTokens };
    }
}

/**
 * Factory: create the appropriate provider based on config.
 * @param {{ provider: string, apiKey: string, model: string }} config
 * @returns {AIProvider}
 */
function createProvider(config) {
    switch (config.provider) {
        case 'anthropic':
            return new AnthropicProvider(config);
        case 'gemini':
        default:
            return new GeminiProvider(config);
    }
}

module.exports = { createProvider };
