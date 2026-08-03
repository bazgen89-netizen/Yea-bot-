import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { SqlDriver } from '../db/driver';
import { openDatabase } from '../db/expoDriver';
import { colors, spacing, text } from '../ui/theme';

interface DatabaseContextValue {
  db: SqlDriver;
  /** Растёт после каждой записи в базу — экраны по нему перечитывают данные. */
  revision: number;
  /** Сообщает приложению, что данные изменились. */
  refresh: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

/**
 * Открывает базу один раз при старте и раздаёт её экранам.
 *
 * Обновление списков сделано счётчиком ревизий, а не подпиской на таблицы:
 * запросы у нас синхронные и дешёвые, а данные меняются только по действию
 * пользователя — этого достаточно и не требует стороннего стейт-менеджера.
 */
type State = { status: 'loading' } | { db: SqlDriver } | { error: Error };

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    openDatabase()
      .then((db) => {
        if (!cancelled) setState({ db });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ error: error as Error });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  const value = useMemo(
    () => ('db' in state ? { db: state.db, revision, refresh } : null),
    [state, revision, refresh],
  );

  if ('error' in state) {
    return (
      <View style={styles.center}>
        <Text style={text.heading}>Не удалось открыть базу данных</Text>
        <Text style={[text.muted, styles.message]}>{state.error.message}</Text>
      </View>
    );
  }

  if (!value) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseContextValue {
  const value = useContext(DatabaseContext);
  if (!value) throw new Error('useDatabase вызван вне DatabaseProvider');
  return value;
}

/**
 * Читает данные из базы и перечитывает их после каждого изменения.
 * `deps` — то, от чего зависит сам запрос (строка поиска, выбранный период).
 */
export function useQuery<T>(selector: (db: SqlDriver) => T, deps: unknown[] = []): T {
  const { db, revision } = useDatabase();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selector(db), [db, revision, ...deps]);
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  message: { textAlign: 'center' },
});
