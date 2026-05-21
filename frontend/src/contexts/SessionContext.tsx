import { createContext, useContext, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { AnalysisSession } from '../types';

const GATEWAY_API = 'http://localhost:3001/api/gateway';

const defaultCase = `案例：御风拏云——亿航智能从技术破壁到场景裂变的技术商业化密码

亿航智能（EHang）是全球首家上市的城市空中交通企业，其EH216-S是全球首款获得适航认证的无人驾驶载人eVTOL飞行器。

核心里程碑：
- 2023年10月：获中国民航局型号合格证（TC）
- 2024年：获生产许可证（PC）和标准适航证（AC），年营收增长288%
- 2025年3月：获运营合格证（OC），成为全球首家具备eVTOL合法商业运营资质的公司

商业化路径：
1. 技术破壁：自主研发飞控系统，8螺旋桨+4机臂"X型"构型，4万架次试飞
2. 适航取证：参与制定全球首套eVTOL适航标准，500余项测试项目
3. 场景裂变：文旅观光→城市通勤→应急救援的渐进式拓展

核心问题：如何在标准真空中建立规则话语权，跨越"死亡之谷"实现规模化商业运营？`;

interface SessionContextType {
  session: AnalysisSession;
  setSession: React.Dispatch<React.SetStateAction<AnalysisSession>>;
  sessionHistory: AnalysisSession[];
  saveToHistory: (s: AnalysisSession) => void;
  switchSession: (id: string) => void;
  deleteHistorySession: (id: string) => void;
  newSession: (title: string) => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useLocalStorage<AnalysisSession>('casebuddy-session', {
    id: 'default',
    title: '亿航智能案例分析',
    caseText: defaultCase,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activeSkills: [],
  });

  const [sessionHistory, setSessionHistory] = useLocalStorage<AnalysisSession[]>('casebuddy-session-history', []);

  const saveToHistory = useCallback((s: AnalysisSession) => {
    if (s.messages.length === 0 && !s.caseText.trim()) return;
    setSessionHistory(prev => {
      const filtered = prev.filter(h => h.id !== s.id);
      return [s, ...filtered].slice(0, 30);
    });
  }, [setSessionHistory]);

  const switchSession = useCallback((targetId: string) => {
    setSessionHistory(prev => {
      // Find target in history
      const target = prev.find(h => h.id === targetId);
      if (!target) return prev;

      setSession(current => {
        if (targetId === current.id) return current;
        // Save current before switching
        if (current.messages.length > 0 || current.caseText.trim()) {
          setSessionHistory(h => {
            const filtered = h.filter(x => x.id !== current.id);
            return [current, ...filtered].slice(0, 30);
          });
        }
        return target;
      });

      return prev;
    });
  }, [setSessionHistory, setSession]);

  const deleteHistorySession = useCallback((id: string) => {
    setSessionHistory(prev => prev.filter(h => h.id !== id));
  }, [setSessionHistory]);

  const newSession = useCallback((title: string) => {
    setSession(current => {
      // Save current session to history
      if (current.messages.length > 0 || current.caseText.trim()) {
        setSessionHistory(prev => {
          const filtered = prev.filter(h => h.id !== current.id);
          return [current, ...filtered].slice(0, 30);
        });
      }
      return {
        id: Date.now().toString(),
        title,
        caseText: '',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeSkills: [],
      };
    });
  }, [setSession, setSessionHistory]);

  // 自动同步 session 摘要到后端（供微信 Bot 查询）
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!session.messages || session.messages.length === 0) return;
    // 防抖：session 变化后 2 秒同步
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      try {
        const summary = session.messages.slice(-20).map(m => ({
          role: m.role,
          content: m.content.slice(0, 1000),
        }));
        fetch(`${GATEWAY_API}/sync-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: summary }),
        }).catch(() => { /* 静默失败 */ });
      } catch { /* ignore */ }
    }, 2000);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [session.messages, session.updatedAt]);

  return (
    <SessionContext.Provider value={{
      session,
      setSession,
      sessionHistory,
      saveToHistory,
      switchSession,
      deleteHistorySession,
      newSession,
    }}>
      {children}
    </SessionContext.Provider>
  );
}
