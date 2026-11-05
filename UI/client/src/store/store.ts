import { combineReducers, configureStore } from '@reduxjs/toolkit';
import type { UnknownAction } from '@reduxjs/toolkit';
import { steelApi } from '../api/steelApi';
import { workflowEditorReducer } from './workflowEditor';
import { templateEditorReducer } from './templateEditor';
import { loadWorkflowRecovery, preserveLocalRecovery, saveWorkflowRecovery } from './workflowRecovery';
import { getSession, onSessionBoundary } from '../auth/session';

const reducer = combineReducers({
    [steelApi.reducerPath]: steelApi.reducer,
    workflowEditor: workflowEditorReducer,
    templateEditor: templateEditorReducer,
});
type State = ReturnType<typeof reducer>;
export function workspaceRootReducer(state: State | undefined, action: UnknownAction): State {
  if (action.type === 'workspaceSession/reset') return reducer(undefined, action);
  if (action.type === 'workspaceSession/restoreLocal') return { ...reducer(undefined, action), workflowEditor: (action as unknown as { payload: State['workflowEditor'] }).payload };
  return reducer(state, action);
}
export const store = configureStore({
  reducer: workspaceRootReducer,
  middleware: (getDefault) => getDefault().concat(steelApi.middleware),
});

let previousWorkflow = store.getState().workflowEditor;
store.subscribe(() => {
  const state = store.getState().workflowEditor;
  if (state === previousWorkflow) return;
  previousWorkflow = state;
  if (getSession().mode === 'local') {
    try { saveWorkflowRecovery(window.sessionStorage, state); } catch { /* unavailable */ }
  }
});

onSessionBoundary(() => {
  // Abort/clear transport state, then discard all account-visible editor data.
  for (const request of store.dispatch(steelApi.util.getRunningQueriesThunk())) request.abort();
  for (const request of store.dispatch(steelApi.util.getRunningMutationsThunk())) request.abort();
  let recovered: State['workflowEditor'] | undefined;
  try {
    preserveLocalRecovery(window.sessionStorage);
    if (getSession().mode === 'local') recovered = loadWorkflowRecovery(window.sessionStorage);
  } catch { /* optional local recovery */ }
  store.dispatch({ type: 'workspaceSession/reset' });
  store.dispatch(steelApi.util.resetApiState());
  if (recovered) store.dispatch({ type: 'workspaceSession/restoreLocal', payload: recovered });
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
