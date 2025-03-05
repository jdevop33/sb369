import { ModelConfig } from '../types';

export const models: ModelConfig[] = [
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    model: 'claude-3-7-sonnet-20250219',
    description: 'Anthropic\'s latest model with enhanced reasoning',
    maxTokens: 4096,
    temperature: 0.7
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    model: 'gpt-4o',
    description: 'OpenAI\'s optimized flagship model',
    maxTokens: 4096,
    temperature: 0.7
  },
  {
    id: 'grok-3',
    name: 'Grok 3',
    provider: 'xai',
    model: 'grok-3',
    description: 'Advanced reasoning with creative problem-solving',
    maxTokens: 4096,
    temperature: 0.7
  }
];

export const defaultModel = models[0];