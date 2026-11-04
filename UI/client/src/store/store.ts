import { configureStore } from '@reduxjs/toolkit';
import { steelApi } from '../api/steelApi';
import { workflowEditorReducer } from './workflowEditor';
import { templateEditorReducer } from './templateEditor';
import { loadWorkflowRecovery, saveWorkflowRecovery } from './workflowRecovery';

const recoveredWorkflow = (() => {
  try { return loadWorkflowRecovery(window.sessionStorage); } catch { return undefined; }
})();

export const store = configureStore({
  preloadedState: recoveredWorkflow ? { workflowEditor: recoveredWorkflow } : undefined,
  reducer: {
    [steelApi.reducerPath]: steelApi.reducer,
    workflowEditor: workflowEditorReducer,
    templateEditor: templateEditorReducer,
  },
  middleware: (getDefault) => getDefault().concat(steelApi.middleware),
});

let previousWorkflow = store.getState().workflowEditor;
store.subscribe(() => {
  const state = store.getState().workflowEditor;
  if (state === previousWorkflow) return;
  previousWorkflow = state;
  try { saveWorkflowRecovery(window.sessionStorage, state); } catch { /* unavailable */ }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
