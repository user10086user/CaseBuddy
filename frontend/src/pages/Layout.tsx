import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Brain,
  MessageSquare,
  Settings,
  Puzzle,
  Menu,
  X,
  ChevronRight,
  Presentation,
  Sparkles,
  History,
  Trash2,
  PlusCircle,
  Wand2,
  MessageCircle,
  Zap
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSession } from '../contexts/SessionContext';

const navItems = [
  { path: '/', label: '首页', icon: Brain },
  { path: '/workbench', label: '分析工作台', icon: MessageSquare },
  { path: '/ppt-assistant', label: 'AI PPT助手', icon: Sparkles },
  { path: '/wechat', label: '微信助手', icon: MessageCircle },
  { path: '/workflow', label: '智能工作流', icon: Zap },
  { path: '/skills', label: '技能市场', icon: Puzzle },
  { path: '/models', label: '模型配置', icon: Settings },
  { path: '/gateway', label: '消息网关', icon: MessageCircle },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on window resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex h-screen bg-surface-50 overflow-hidden">
      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden animate-fade-in-scale"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <aside
        className={`hidden md:flex ${sidebarOpen ? 'w-60' : 'w-16'}
          bg-surface-900 text-white transition-all duration-300 ease-out
          flex-col border-r border-surface-700 flex-shrink-0`}
      >
        <SidebarContent
          sidebarOpen={sidebarOpen}
          location={location}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
        />
      </aside>

      {/* Sidebar - Mobile Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface-900 text-white
          transform transition-transform duration-300 ease-out md:hidden
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          flex flex-col`}
      >
        <SidebarContent
          sidebarOpen={true}
          location={location}
          onToggle={() => setMobileMenuOpen(false)}
          isMobile
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden min-w-0 flex flex-col">
        {/* Mobile Header */}
        <div className="md:hidden h-14 bg-surface-900 text-white flex items-center px-4 flex-shrink-0 z-30">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 -ml-2 hover:bg-surface-800 rounded-lg transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="ml-3 flex items-center gap-2">
            <Brain className="w-6 h-6 text-accent-400" />
            <span className="font-bold text-lg">CaseBuddy</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin animate-fade-in-scale">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/* Sidebar inner content */
function SidebarContent({
  sidebarOpen,
  location,
  onToggle,
  isMobile = false,
}: {
  sidebarOpen: boolean;
  location: ReturnType<typeof useLocation>;
  onToggle: () => void;
  isMobile?: boolean;
}) {
  const navigate = useNavigate();
  const { session, sessionHistory, switchSession, deleteHistorySession, newSession } = useSession();
  const [showHistory, setShowHistory] = useState(true);

  const handleSwitchSession = (id: string) => {
    switchSession(id);
    if (location.pathname !== '/workbench') {
      navigate('/workbench');
    }
  };

  const handleNewSession = () => {
    const title = window.prompt('输入新会话标题', '新建案例分析');
    if (title === null) return;
    newSession(title || '新建案例分析');
    if (location.pathname !== '/workbench') {
      navigate('/workbench');
    }
  };

  return (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-surface-700 flex-shrink-0">
        <Brain className="w-8 h-8 text-accent-400 flex-shrink-0" />
        {sidebarOpen && (
          <span className="ml-3 font-bold text-lg tracking-wide">
            CaseBuddy
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex items-center mx-2 rounded-lg transition-all duration-200
                ${sidebarOpen ? 'px-3 py-2.5' : 'px-0 py-3 justify-center'}
                ${isActive
                  ? 'bg-primary-600/90 text-white shadow-sm shadow-primary-900/20'
                  : 'text-surface-400 hover:bg-surface-800/80 hover:text-white'
                }`}
              title={!sidebarOpen ? item.label : undefined}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-white' : ''}`} />
              {sidebarOpen && (
                <>
                  <span className="ml-3 text-sm font-medium">{item.label}</span>
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto opacity-60" />}
                </>
              )}
              {!sidebarOpen && isActive && (
                <span className="absolute left-14 w-1.5 h-1.5 rounded-full bg-accent-400" />
              )}
            </NavLink>
          );
        })}

        {/* Session History - inside nav */}
        {sidebarOpen && (
          <>
            {/* Divider */}
            <div className="mx-4 my-2 border-t border-surface-700/60" />

            {/* Section header */}
            <div className="flex items-center justify-between px-4 py-1">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-surface-500 hover:text-surface-300 transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">会话历史</span>
                <span className="text-[10px] text-surface-600">({sessionHistory.filter(h => h.id !== session.id).length + 1})</span>
              </button>
              <button
                onClick={handleNewSession}
                className="text-surface-500 hover:text-accent-400 transition-colors p-0.5"
                title="新建会话"
              >
                <PlusCircle className="w-3.5 h-3.5" />
              </button>
            </div>

            {showHistory && (
              <div className="space-y-0.5 px-2">
                {/* Current session */}
                <div
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-primary-600/20 text-primary-300 cursor-default"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">{session.title}</span>
                  <span className="text-[10px] text-surface-500 flex-shrink-0">{session.messages.length}条</span>
                </div>
                {/* History sessions */}
                {sessionHistory
                  .filter(h => h.id !== session.id)
                  .map(h => (
                    <div
                      key={h.id}
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-lg text-surface-400 hover:bg-surface-800/60 hover:text-surface-200 cursor-pointer transition-colors"
                      onClick={() => handleSwitchSession(h.id)}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-surface-600 flex-shrink-0" />
                      <span className="text-xs truncate flex-1">{h.title}</span>
                      <span className="text-[10px] text-surface-600 flex-shrink-0">{h.messages.length}条</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteHistorySession(h.id); }}
                        className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-rose-400 transition-opacity p-0.5"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                {sessionHistory.filter(h => h.id !== session.id).length === 0 && (
                  <div className="px-2 py-1.5 text-[11px] text-surface-600 text-center">暂无历史会话</div>
                )}
              </div>
            )}
          </>
        )}
      </nav>

      {/* Toggle */}
      <button
        onClick={onToggle}
        className="h-12 flex items-center justify-center border-t border-surface-700
          hover:bg-surface-800 transition-colors flex-shrink-0"
      >
        {isMobile ? (
          <X className="w-5 h-5" />
        ) : sidebarOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <Menu className="w-5 h-5" />
        )}
      </button>
    </>
  );
}
