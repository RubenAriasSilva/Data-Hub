import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { api } from '../api/client';

const AppContext = createContext(null);

const TOAST_ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const TOAST_COLORS = { success: 'var(--success)', error: 'var(--error)', info: 'var(--accent)' };

export function AppProvider({ children }) {
  const [categories, setCategories] = useState([]);
  const [health, setHealth] = useState(null);
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const refreshCategories = useCallback(async () => {
    try {
      setCategories(await api.get('/categories'));
    } catch {
      setCategories([]);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealth(data);
      return data;
    } catch {
      setHealth({ status: 'down', db: { ready: false, error: 'No se pudo contactar al servidor' } });
      return null;
    }
  }, []);

  const toast = useCallback((message, type = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    let timer;
    const tick = async () => {
      const h = await checkHealth();
      if (h?.db?.ready) refreshCategories();
      // Mientras la BD no esté lista, reintentar cada 5 s; luego cada 30 s
      timer = setTimeout(tick, h?.db?.ready ? 30000 : 5000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [checkHealth, refreshCategories]);

  return (
    <AppContext.Provider value={{ categories, refreshCategories, health, toast }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => {
          const Icon = TOAST_ICONS[t.type] ?? Info;
          return (
            <div key={t.id} className="glass-strong toast">
              <Icon size={18} color={TOAST_COLORS[t.type]} />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
