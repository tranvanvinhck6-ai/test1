'use strict';

/**
 * @fileoverview UniversalAIClient - Adapter hợp nhất cho Google Gemini và Anthropic Claude.
 * Đã nâng cấp với:
 * - Retry + Exponential Backoff cho các lỗi 429 / 503 / 529
 * - Prompt Caching cho Anthropic Claude API (giảm chi phí & độ trễ)
 * - Model Tiering (Định tuyến 'fast' vs 'smart')
 */

const AI_MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES || '3', 10);
const AI_PROMPT_CACHE = process.env.AI_PROMPT_CACHE !== 'false';

class UniversalAIClient {
  constructor({ provider, apiKey, defaultModel }) {
    this.provider = provider;
    this.apiKey = apiKey;
    
    // Khởi tạo model mapping cho 'fast' và 'smart' tier
    if (provider === 'gemini') {
      this.modelSmart = process.env.GEMINI_MODEL_SMART || process.env.GEMINI_MODEL || 'gemini-2.5-pro';
      this.modelFast = process.env.GEMINI_MODEL_FAST || 'gemini-2.5-flash';
    } else {
      this.modelSmart = process.env.CLAUDE_MODEL_SMART || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
      this.modelFast = process.env.CLAUDE_MODEL_FAST || 'claude-3-5-haiku-20241022';
    }
    
    this.defaultModel = defaultModel || this.modelSmart;
    this.model = this.defaultModel;
    
    this.anthropicClient = null;
    if (this.provider === 'anthropic') {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        this.anthropicClient = new Anthropic({ apiKey: this.apiKey });
      } catch (err) {
        console.error('[UniversalAIClient] Lỗi khởi tạo Anthropic SDK:', err.message);
      }
    }

    this.messages = {
      create: async (params) => {
        return this._withRetry(() => this._createMessage(params));
      }
    };
  }

  /**
   * Helper Retry + Exponential Backoff
   * @private
   */
  async _withRetry(fn, retries = 1) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const msg = error.message || '';
        
        // Nếu hết Quota (429 free tier limit), throw ngay lập tức để kích hoạt fallback offline của MCQGenerator, không treo chờ
        const isQuotaExceeded = msg.includes('Quota exceeded') || msg.includes('limit: 0') || msg.includes('free_tier');
        if (isQuotaExceeded) {
          console.warn(`[AIClient] ⚠️ Hết Quota API miễn phí (429). Chuyển ngay sang bộ câu hỏi USMLE High-Yield dự phòng offline...`);
          throw error;
        }

        const isRateLimit = msg.includes('429') || msg.includes('503') || msg.includes('529') || msg.includes('overloaded');
        if (!isRateLimit || attempt === retries) {
          throw error;
        }

        // Chỉ chờ tối đa 2 giây cho 1 lần thử lại duy nhất
        const waitMs = Math.min(Math.pow(2, attempt) * 1000 + Math.random() * 500, 2000);
        console.warn(`[AIClient] ⚠️ Gặp lỗi API (${msg.slice(0, 60)}...). Đang thử lại lần ${attempt + 1}/${retries} sau ${Math.round(waitMs)}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
    throw lastError;
  }

  /** Resolve tên model theo alias 'fast' / 'smart' */
  _resolveModel(requestedModel) {
    if (requestedModel === 'fast') return this.modelFast;
    if (requestedModel === 'smart') return this.modelSmart;
    let target = requestedModel || this.defaultModel || this.modelSmart;
    if (this.provider === 'gemini' && target.includes('claude')) return this.modelSmart;
    if (this.provider === 'anthropic' && target.includes('gemini')) return this.modelSmart;
    return target;
  }

  setModel(newModel) {
    if (newModel && typeof newModel === 'string') {
      this.model = this._resolveModel(newModel);
      this.defaultModel = this.model;
      if (newModel.includes('claude')) this.provider = 'anthropic';
      else if (newModel.includes('gemini')) this.provider = 'gemini';
      console.log(`[UniversalAIClient] Switched active model to: ${this.model} (${this.provider.toUpperCase()})`);
    }
  }

  static createFromEnv() {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiKey && geminiKey !== 'AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxx' && geminiKey.trim() !== '') {
      return new UniversalAIClient({ provider: 'gemini', apiKey: geminiKey.trim() });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey && anthropicKey !== 'sk-ant-xxxxxxxxxxxxxxxxxxxx' && anthropicKey.trim() !== '') {
      return new UniversalAIClient({ provider: 'anthropic', apiKey: anthropicKey.trim() });
    }

    return null;
  }

  async _createMessage(params) {
    const { model, max_tokens, temperature, system, messages } = params;
    const targetModel = this._resolveModel(model);

    if (this.provider === 'gemini') {
      return this._callGemini({ model: targetModel, max_tokens, temperature, system, messages });
    } else {
      return this._callAnthropic({ model: targetModel, max_tokens, temperature, system, messages });
    }
  }

  async _callGemini({ model, max_tokens, temperature, system, messages }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const contents = [];
    
    for (const m of (messages || [])) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      let text = '';
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content)) text = m.content.map(c => c.text || JSON.stringify(c)).join('\n');
      else text = JSON.stringify(m.content || '');

      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += '\n\n' + text;
      } else {
        contents.push({ role: role, parts: [{ text: text }] });
      }
    }

    const generationConfig = {
      temperature: temperature !== undefined ? temperature : 0.7,
      maxOutputTokens: max_tokens || 8192
    };

    if (system && (typeof system === 'string' ? system : JSON.stringify(system)).toLowerCase().includes('json')) {
      generationConfig.responseMimeType = 'application/json';
    }

    const body = { contents: contents, generationConfig: generationConfig };
    if (system) {
      const sysText = typeof system === 'string' ? system : JSON.stringify(system);
      body.systemInstruction = { parts: [{ text: sysText }] };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error?.message || errText;
      } catch (e) {}
      throw new Error(`Google Gemini API error (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';

    return {
      id: 'msg_gemini_' + Date.now(),
      model: model,
      provider: 'gemini',
      content: [{ type: 'text', text: text }],
      usage: {
        input_tokens: data.usageMetadata?.promptTokenCount || 0,
        output_tokens: data.usageMetadata?.candidatesTokenCount || 0
      }
    };
  }

  async _callAnthropic({ model, max_tokens, temperature, system, messages }) {
    if (!this.anthropicClient) throw new Error('Anthropic SDK chưa được khởi tạo');

    // Prompt Caching cho Claude API: nếu system dài > 500 ký tự và bật AI_PROMPT_CACHE
    let formattedSystem = system;
    if (AI_PROMPT_CACHE && system && typeof system === 'string' && system.length > 500) {
      formattedSystem = [
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' }
        }
      ];
    }

    return this.anthropicClient.messages.create({
      model: model,
      max_tokens: max_tokens || 8192,
      temperature: temperature !== undefined ? temperature : 0.7,
      system: formattedSystem,
      messages: messages
    });
  }
}

module.exports = UniversalAIClient;
