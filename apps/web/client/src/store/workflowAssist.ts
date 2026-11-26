import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { WorkflowVersionRow } from '../api/contracts';

export type AssistMessage =
  | { kind: 'prompt'; text: string }
  | { kind: 'reply'; text: string }
  | { kind: 'error'; text: string; prompt: string }
  | { kind: 'draft'; row: WorkflowVersionRow; opened: boolean }
  | { kind: 'model'; name: string; id: string };

interface AssistConversation {
  messages: AssistMessage[];
  composer: string;
  previous?: WorkflowVersionRow;
  clarifications: { prompt: string; reply: string }[];
}

const initialState: AssistConversation = { messages: [], composer: '', clarifications: [] };

const conversation = createSlice({
  name: 'workflowAssist',
  initialState,
  reducers: {
    assistComposerChanged(state, action: PayloadAction<string>) {
      state.composer = action.payload;
    },
    assistMessageAdded(state, action: PayloadAction<AssistMessage>) {
      state.messages.push(action.payload);
      if (action.payload.kind === 'draft') {
        state.previous = action.payload.row;
        state.clarifications = [];
      }
      if (action.payload.kind === 'model') {
        state.previous = undefined;
        state.clarifications = [];
      }
    },
    assistReplyAdded(state, action: PayloadAction<{ prompt: string; reply: string }>) {
      state.messages.push({ kind: 'reply', text: action.payload.reply });
      state.clarifications = [...state.clarifications, action.payload].slice(-4);
    },
    assistConversationCleared() {
      return initialState;
    },
  },
});

export const {
  assistComposerChanged, assistMessageAdded, assistReplyAdded, assistConversationCleared,
} = conversation.actions;
export const workflowAssistReducer = conversation.reducer;
