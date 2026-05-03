import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { pollingCoordinator } from '../../services/pollingCoordinator';
import { ChatV2Engine } from '../../core/chatEngine';
import { createMockRuntimeAdapter } from '../runtime/mockRuntimeAdapter';
import { createElectronRuntimeAdapter } from '../runtime/createElectronRuntimeAdapter';
import { ChatV2Surface } from './ChatV2Surface';
import { VaultSafetyBar } from './VaultSafetyBar';
import { RUNTIME_MODES, WORKSPACE_IDS } from '../../core/types';
import { buildChatV2InferenceOptions } from '../runtime/buildInferenceOptions';
import { attachAudioLayer } from '../runtime/audioLayer';
import { attachHapticBridge } from '../runtime/hapticBridge';

export function ChatV2Harness({ forceMode = null, title = null }) {
  const currentModel = useAppStore((s) => s.currentModel);
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const currentBranchId = useAppStore((s) => s.currentBranchId);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const syncRef = useRef({ conversationListSignature: '' });

  const mode = useMemo(() => {
    if (forceMode === RUNTIME_MODES.LIVE || forceMode === RUNTIME_MODES.MOCK) return forceMode;
    if (typeof window === 'undefined') return RUNTIME_MODES.LIVE;
    const queryMock = new URLSearchParams(window.location.search).get('chatv2mock') === '1';
    return queryMock ? RUNTIME_MODES.MOCK : RUNTIME_MODES.LIVE;
  }, [forceMode]);

  const engine = useMemo(() => {
    const storeState = useAppStore.getState();
    const workspace = storeState.currentWorkspace || WORKSPACE_IDS.CASUAL;
    const runtime = mode === RUNTIME_MODES.LIVE
      ? createElectronRuntimeAdapter({
          workspace,
          getWorkspace: () => useAppStore.getState().currentWorkspace || WORKSPACE_IDS.CASUAL,
          getPrivatePassword: () => useAppStore.getState().nsfwPassword || null,
          getInferenceOptions: async (request = {}) => {
            const state = useAppStore.getState();
            return buildChatV2InferenceOptions({
              model: request.model || state.currentModel,
              workspace: request.workspace || state.currentWorkspace || WORKSPACE_IDS.CASUAL,
              prompt: request.prompt || '',
              controls: request.controls || {},
            });
          },
        })
      : createMockRuntimeAdapter({ delayMs: 20 });

    return new ChatV2Engine(runtime, {
      workspace,
      model: mode === RUNTIME_MODES.LIVE ? storeState.currentModel || null : 'chat-v2-mock',
    });
  }, [mode]);

  const normalizeId = useCallback((value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
  }, []);

  const refreshConversationList = useCallback(async () => {
    const conversations = await loadConversations?.();
    if (Array.isArray(conversations)) {
      useAppStore.setState({ conversations });
    }
    return conversations || [];
  }, [loadConversations]);

  useEffect(() => {
    return () => engine.destroy();
  }, [engine]);

  useEffect(() => {
    engine.setWorkspace(currentWorkspace || WORKSPACE_IDS.CASUAL);
  }, [engine, currentWorkspace]);

  useEffect(() => {
    if (mode !== RUNTIME_MODES.LIVE) return undefined;
    if (currentWorkspace !== WORKSPACE_IDS.VAULT) return undefined;
    const detach = attachAudioLayer(engine, { workspace: currentWorkspace });
    return () => { try { detach?.(); } catch (_) { /* noop */ } };
  }, [engine, mode, currentWorkspace]);

  useEffect(() => {
    if (mode !== RUNTIME_MODES.LIVE) return undefined;
    const detach = attachHapticBridge(engine, {
      getWorkspace: () => useAppStore.getState().currentWorkspace || WORKSPACE_IDS.CASUAL,
    });
    return () => { try { detach?.(); } catch (_) { /* noop */ } };
  }, [engine, mode]);

  useEffect(() => {
    if (mode === RUNTIME_MODES.LIVE) {
      engine.setModel(currentModel || null);
    }
  }, [engine, mode, currentModel]);

  useEffect(() => {
    if (mode !== RUNTIME_MODES.LIVE || !currentModel) return;
    const api = window.electronAPI;
    if (!api || typeof api.prewarmSpecDecodeVerifier !== 'function') return;
    let cancelled = false;
    Promise.resolve(api.prewarmSpecDecodeVerifier({ model: currentModel })).then((result) => {
      if (cancelled || !result?.warmed) return;
      // Verifier is hot for the first spec-decode turn on this session.
    }).catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, [mode, currentModel]);

  useEffect(() => {
    if (mode !== RUNTIME_MODES.LIVE) return;
    void engine.refreshRuntimeState(true);
    const unsub = pollingCoordinator.subscribe('chatV2:runtimeRefresh', {
      run: () => { void engine.refreshRuntimeState(); },
      intervalMs: 5000,
    });
    return unsub;
  }, [engine, mode]);

  // Keep vanilla chat behavior stable across models:
  // don't auto-warmup on each model switch (users can warm manually).

  useEffect(() => {
    if (mode !== RUNTIME_MODES.LIVE) return;
    const conversationId = normalizeId(currentConversationId);
    const branchId = normalizeId(currentBranchId);
    const engineState = engine.getState();
    const activeConversationId = normalizeId(engineState.conversationId);
    const activeBranchId = normalizeId(engineState.currentBranchId);

    if (!conversationId) {
      if (activeConversationId || engineState.messages.length > 0 || engineState.error || engineState.draftAttachments.length > 0) {
        engine.resetConversation({
          preserveRuntimeState: true,
          workspace: currentWorkspace || WORKSPACE_IDS.CASUAL,
        });
      }
      syncRef.current.conversationListSignature = '';
      return;
    }

    if (conversationId === activeConversationId && (!branchId || branchId === activeBranchId)) {
      return;
    }

    void engine.hydrateConversation({
      conversationId,
      branchId,
    });
  }, [engine, mode, currentConversationId, currentBranchId, currentWorkspace, normalizeId]);

  useEffect(() => {
    const syncStoreFromEngine = (nextState) => {
      const nextConversationId = normalizeId(nextState.conversationId);
      const nextBranchId = normalizeId(nextState.currentBranchId);
      const storeState = useAppStore.getState();
      const patch = {};

      if (normalizeId(storeState.currentConversationId) !== nextConversationId) {
        patch.currentConversationId = nextConversationId;
      }
      if (normalizeId(storeState.currentBranchId) !== nextBranchId) {
        patch.currentBranchId = nextBranchId;
      }
      if (storeState.messages !== nextState.messages) {
        patch.messages = nextState.messages;
      }

      if (Object.keys(patch).length > 0) {
        useAppStore.setState(patch);
      }

      const signature = [
        nextConversationId || '',
        nextBranchId || '',
        nextState.messages.length,
        nextState.lastUserMessageId || '',
        nextState.lastAssistantMessageId || '',
      ].join(':');

      if (nextConversationId && signature !== syncRef.current.conversationListSignature) {
        syncRef.current.conversationListSignature = signature;
        void refreshConversationList();
      }
    };

    syncStoreFromEngine(engine.getState());
    const unsub = engine.subscribe(syncStoreFromEngine);
    return unsub;
  }, [engine, normalizeId, refreshConversationList]);

  const surfaceTitle = title || (mode === RUNTIME_MODES.LIVE
    ? (currentModel || 'Chat')
    : 'Chat (Demo)');

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <ChatV2Surface engine={engine} title={surfaceTitle} />
      <VaultSafetyBar engine={engine} workspace={currentWorkspace} />
    </div>
  );
}

export default ChatV2Harness;
