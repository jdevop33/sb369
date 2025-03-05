import { useState, useCallback, useEffect } from 'react';
import { Message, ModelConfig, BylawChunk } from '../types';
import { createMessage, extractCitations } from '../lib/utils';
import { defaultModel } from '../config/models';
import { retrieveRelevantChunks } from '../lib/retriever';
import { v4 as uuidv4 } from 'uuid';
import { useChat as useAIChat } from '@ai-sdk/react';

interface UseChatOptions {
  initialMessages?: Message[];
  initialModel?: ModelConfig;
}

export function useChat({ 
  initialMessages = [], 
  initialModel = defaultModel 
}: UseChatOptions = {}) {
  // Create system message if not present in initialMessages
  if (!initialMessages.some(m => m.role === 'system')) {
    initialMessages = [
      createMessage('system', `You are a helpful municipal bylaw assistant. 
      Your purpose is to provide accurate information about municipal bylaws, regulations, and amendments.
      Always cite your sources using the format [citation: {"text": "exact text from bylaw", "source": "bylaw name", "section": "section number or name"}].
      If you're unsure about something, acknowledge the uncertainty rather than making up information.
      Focus on providing factual, up-to-date information based on the most recent amendments.`),
      ...initialMessages
    ];
  }

  // Use AI SDK's useChat hook
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    data,
    append
  } = useAIChat({
    api: '/api/chat',
    initialMessages,
    body: { model: initialModel },
    onResponse: (response) => {
      // Handle response metadata if needed
    },
    onFinish: (message) => {
      // Handle message completion if needed
    },
    maxSteps: 1, // No tool calling in this implementation yet
  });

  const [selectedModel, setSelectedModel] = useState<ModelConfig>(initialModel);
  const [relevantChunks, setRelevantChunks] = useState<BylawChunk[]>([]);
  
  // Update relevantChunks when new data is received
  useEffect(() => {
    if (data?.relevant_chunks) {
      setRelevantChunks(data.relevant_chunks);
    }
  }, [data]);

  // Also check message annotations for relevant chunks
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.annotations?.relevant_chunks) {
      setRelevantChunks(lastMessage.annotations.relevant_chunks);
    }
  }, [messages]);

  // Custom message sender that keeps our model configuration
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;
    
    await append({
      role: 'user',
      content,
    }, {
      body: { model: selectedModel }
    });
  }, [append, selectedModel]);

  const changeModel = useCallback((model: ModelConfig) => {
    setSelectedModel(model);
  }, []);

  const resetChat = useCallback(() => {
    // Filter to keep only system messages
    const systemMessages = messages.filter(m => m.role === 'system');
    
    // Reset the chat
    // Note: AI SDK's useChat doesn't have a built-in reset,
    // so we simulate it by setting messages to only system messages
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'system') {
        // TODO: Implement proper reset when AI SDK adds support
      }
    }
    
    setRelevantChunks([]);
  }, [messages]);

  return {
    messages,
    input,
    handleInputChange,
    isLoading,
    error,
    selectedModel,
    relevantChunks,
    sendMessage,
    changeModel,
    resetChat
  };
}