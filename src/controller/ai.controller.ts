// src/controllers/aiController.ts

import type { Env } from '../types/env';
import { jsonResp } from '../utils/response';
import { CODE } from '../types/response';
import { callZhipu, type ZhipuMessage } from '../config/zhipu';

export class AIController {
  /**
   * 统一AI异常处理
   */
  private static handleAIError(err: any) {
    // 智谱限流 429 code:1305
    if (err?.status === CODE.RATE_LIMIT && err?.code === 1305) {
      return jsonResp(null, CODE.RATE_LIMIT, '该模型当前访问量过大，请您稍后再试');
    }
    // 未配置密钥
    if (err.message?.includes('ZHIPU_API_KEY')) {
      return jsonResp(null, CODE.SERVER_ERR, '服务端未配置AI密钥，请联系管理员');
    }
    // 通用服务异常
    return jsonResp(null, CODE.SERVER_ERR, err.message || 'AI服务调用异常，请稍后重试');
  }

  /**
   * 通用执行AI请求
   */
  private static async runZhipu(
    env: Env,
    prompt: string,
    temperature = 0.7,
    maxTokens = 2000
  ) {
    return await callZhipu(
      env,
      [{ role: 'user', content: prompt }],
      temperature,
      maxTokens
    );
  }

  /**
   * 1. AI 对话聊天（支持历史上下文）
   * POST /api/ai/chat
   */
  static async chat(
    env: Env,
    body: { prompt: string; history?: ZhipuMessage[]; temperature?: number; max_tokens?: number }
  ) {
    try {
      let { prompt, history = [], temperature = 0.7, max_tokens = 2000 } = body;

      // ✅ 如果 prompt 为空，尝试从 history 中提取
      if (!prompt?.trim()) {
        const lastUserMessage = history.filter(m => m.role === 'user').pop();
        if (lastUserMessage) {
          prompt = lastUserMessage.content;
          history = history.filter(m => m !== lastUserMessage);
        }
      }

      // ✅ 检查是否包含 system 消息，并将其合并到 prompt 中
      const systemMessages = history.filter(m => m.role === 'system');
      let systemPrompt = '';
      if (systemMessages.length > 0) {
        systemPrompt = systemMessages.map(m => m.content).join('\n');
        // 从 history 中移除 system 消息
        history = history.filter(m => m.role !== 'system');
      }

      // ✅ 构建最终的 prompt
      let finalPrompt = prompt || '请开始对话';
      if (systemPrompt && finalPrompt) {
        finalPrompt = `${systemPrompt}\n\n${finalPrompt}`;
      } else if (systemPrompt) {
        finalPrompt = systemPrompt;
      }

      if (!finalPrompt?.trim()) {
        return jsonResp(null, CODE.PARAM_ERR, '请输入对话内容');
      }

      // ✅ 构建消息列表
      const messages: ZhipuMessage[] = [];

      // 添加历史消息（只保留 user 和 assistant）
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push(msg);
        }
      }

      // 添加当前用户消息
      messages.push({ role: 'user', content: finalPrompt });

      const reply = await callZhipu(env, messages, temperature, max_tokens);
      return jsonResp({ reply }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 2. 笔记内容总结
   * POST /api/ai/summarize
   */
  static async summarize(env: Env, body: { content: string }) {
    try {
      const { content } = body;
      if (!content?.trim()) {
        return jsonResp(null, CODE.PARAM_ERR, '笔记内容不能为空');
      }
      const prompt = `请对下面这段笔记内容进行精简总结，语言通顺精炼：\n${content}`;
      const summary = await this.runZhipu(env, prompt, 0.3);
      return jsonResp({ summary }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 3. 笔记润色优化
   * POST /api/ai/polish
   */
  static async polish(env: Env, body: { content: string }) {
    try {
      const { content } = body;
      if (!content?.trim()) {
        return jsonResp(null, CODE.PARAM_ERR, '笔记内容不能为空');
      }
      const prompt = `帮我润色下面这段笔记，修正语病、优化语句通顺度，保持原有原意，只返回优化后的内容：\n${content}`;
      const polished = await this.runZhipu(env, prompt, 0.4);
      return jsonResp({ polished }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 4. 续写笔记
   * POST /api/ai/continue
   */
  static async continueWrite(env: Env, body: { content: string }) {
    try {
      const { content } = body;
      if (!content?.trim()) {
        return jsonResp(null, CODE.PARAM_ERR, '笔记内容不能为空');
      }
      const prompt = `基于下面这段笔记的内容，合理往下续写内容，保持原文风格一致：\n${content}`;
      const continue_content = await this.runZhipu(env, prompt, 0.7);
      return jsonResp({ continue_content }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }

  /**
   * 5. 文本翻译
   * POST /api/ai/translate
   */
  static async translate(
    env: Env,
    body: { content: string; target_lang?: string }
  ) {
    try {
      const { content, target_lang = '英文' } = body;
      if (!content?.trim()) {
        return jsonResp(null, CODE.PARAM_ERR, '待翻译内容不能为空');
      }
      const prompt = `将下面文本翻译成${target_lang}，只返回翻译结果，不要额外解释：\n${content}`;
      const result = await this.runZhipu(env, prompt, 0.2);
      return jsonResp({ result }, CODE.SUCCESS);
    } catch (err) {
      return this.handleAIError(err);
    }
  }
}