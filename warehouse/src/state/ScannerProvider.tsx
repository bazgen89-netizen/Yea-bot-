import { useRouter } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useMemo, useRef } from 'react';

interface ScannerContextValue {
  /**
   * Открывает сканер и возвращает считанный штрихкод.
   * null — пользователь закрыл сканер, ничего не отсканировав.
   */
  scanBarcode: () => Promise<string | null>;
  /** Вызывается экраном сканера. Не предназначено для использования в других местах. */
  resolveScan: (code: string | null) => void;
}

const ScannerContext = createContext<ScannerContextValue | null>(null);

/**
 * Делает сканер обычным `await`-вызовом вместо передачи результата через
 * параметры маршрута: экран, открывший сканер, не перемонтируется и не теряет
 * уже введённые поля.
 */
export function ScannerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pending = useRef<((code: string | null) => void) | null>(null);

  const scanBarcode = useCallback(() => {
    // Если предыдущий сканер почему-то остался висеть — закрываем его промис,
    // иначе вызывающий код будет ждать вечно.
    pending.current?.(null);

    return new Promise<string | null>((resolve) => {
      pending.current = resolve;
      router.push('/scan');
    });
  }, [router]);

  const resolveScan = useCallback((code: string | null) => {
    const resolve = pending.current;
    pending.current = null;
    resolve?.(code);
  }, []);

  const value = useMemo(() => ({ scanBarcode, resolveScan }), [scanBarcode, resolveScan]);

  return <ScannerContext.Provider value={value}>{children}</ScannerContext.Provider>;
}

export function useScanner(): ScannerContextValue {
  const value = useContext(ScannerContext);
  if (!value) throw new Error('useScanner вызван вне ScannerProvider');
  return value;
}
