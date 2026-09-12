import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

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

  /**
   * Соседнее окно записало базу — перечитываем.
   *
   * Касса открывается своим окном, и без этого кабинет показывал бы остатки
   * такими, какими они были до первого чека.
   */
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let stop: (() => void) | undefined;
    void import('../db/webDriver').then((module) => {
      stop = module.onDatabaseReloaded(refresh);
    });

    return () => stop?.();
  }, [refresh]);

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

  /*
   * Пока база открывается — не голый кружок, а объяснение.
   *
   * На телефоне запуск занимает около минуты: замерено на процессоре
   * вчетверо медленнее этой машины — четыре секунды на разбор страницы и
   * пятьдесят на то, чтобы поднять базу. Всё это время крутился кружок без
   * единого слова, и Вазген решил, что данные не загрузились вовсе:
   * «открываю, а там ничего нет, всё пусто».
   *
   * Кружок без подписи и правда ничего не обещает. Слова обещают.
   */
  if (!value) {
    return (
      <View style={styles.center}>
        <Text style={styles.знак}>WAYSTEA</Text>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.ждём}>Открываю склад и кассу…</Text>
        <Text style={styles.долго}>
          Первый запуск на телефоне занимает до минуты: вся история покупок лежит в
          самой программе, и её надо поднять.
        </Text>
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
  знак: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.primary,
    marginBottom: spacing.lg,
  },
  ждём: { fontSize: 17, color: colors.text, marginTop: spacing.md },
  долго: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 20,
  },
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
