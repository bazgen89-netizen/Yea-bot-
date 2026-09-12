import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  getPosSettings,
  POS_DEFAULTS,
  savePosSettings,
  type PosSettings,
} from '../db/posSettings';
import { useDatabase } from './DatabaseProvider';

/**
 * Настройки кассы, живущие в памяти.
 *
 * Раньше каждый переключатель в «Настройках» писал их в базу и дёргал общий
 * `refresh()`. Тот поднимает ревизию, а по ревизии перечитывают **все**
 * запросы приложения: витрина на шесть сотен товаров, клиенты, смены — и
 * следом вся база sql.js сбрасывается в IndexedDB. Отсюда и заминка на
 * каждое нажатие: чтобы поставить галочку «звук», касса пересчитывала
 * каталог.
 *
 * Здесь настройки держатся в состоянии React: нажатие меняет их сразу, в базу
 * они уходят тем же вызовом, но никого больше не будят. Перечитывает только
 * то, что от них действительно зависит, — витрина, у которой они в `deps`.
 */

interface PosSettingsValue {
  settings: PosSettings;
  /** Поменять часть настроек: сразу на экране и сразу в базе. */
  set: (patch: Partial<PosSettings>) => void;
  /** «Установить настройки по умолчанию» — красная кнопка внизу окна. */
  reset: () => void;
}

const PosSettingsContext = createContext<PosSettingsValue | null>(null);

export function PosSettingsProvider({ children }: { children: ReactNode }) {
  const { db } = useDatabase();

  const [settings, setSettings] = useState<PosSettings>(() => getPosSettings(db));

  // Запись в базу — побочное действие, и делать её внутри обновления состояния
  // нельзя: React вправе вызвать обновление дважды. Поэтому текущие настройки
  // продублированы ссылкой, а состояние меняется уже готовым значением.
  const current = useRef(settings);

  const set = useCallback(
    (patch: Partial<PosSettings>) => {
      const next = { ...current.current, ...patch };
      current.current = next;
      savePosSettings(db, next);
      setSettings(next);
    },
    [db],
  );

  const reset = useCallback(() => {
    current.current = POS_DEFAULTS;
    savePosSettings(db, POS_DEFAULTS);
    setSettings(POS_DEFAULTS);
  }, [db]);

  const value = useMemo<PosSettingsValue>(() => ({ settings, set, reset }), [settings, set, reset]);

  return <PosSettingsContext.Provider value={value}>{children}</PosSettingsContext.Provider>;
}

export function usePosSettings(): PosSettingsValue {
  const value = useContext(PosSettingsContext);
  if (!value) throw new Error('usePosSettings вызван вне PosSettingsProvider');
  return value;
}
