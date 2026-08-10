/**
 * Состояние фильтров каталога — общее для телефона и кабинета.
 *
 * Отдельно от экранов потому, что экранов два, а набор фильтров один: если
 * каждый заведёт свой список пресетов, они разойдутся при первой же правке.
 * Здесь только состояние и переключение — сами условия живут в `db/products`.
 */
import { useCallback, useMemo, useState } from 'react';

import {
  PRESETS,
  PRESET_LABEL,
  deleteFilter,
  listSavedFilters,
  presetCounts,
  saveFilter,
  type ProductPreset,
  type SavedFilter,
} from '../db/products';
import { useDatabase, useQuery } from './DatabaseProvider';

export interface CatalogFilters {
  /** Что выбрано сейчас. */
  presets: ProductPreset[];
  toggle: (preset: ProductPreset) => void;
  clear: () => void;
  /** Сколько товаров под каждым фильтром — числа рядом с названиями. */
  counts: Record<ProductPreset, number>;
  /** Сколько фильтров включено: по нему подсвечивается кнопка. */
  active: number;
  /** Свои сохранённые наборы. */
  saved: SavedFilter[];
  apply: (filter: SavedFilter) => void;
  save: (name: string) => void;
  remove: (name: string) => void;
  /** Названия выбранных фильтров — для строки под панелью. */
  labels: string[];
}

export function useCatalogFilters(): CatalogFilters {
  const { db, refresh } = useDatabase();
  const [presets, setPresets] = useState<ProductPreset[]>([]);

  // Числа считаются от полного каталога, а не от уже отфильтрованного:
  // «отрицательный остаток — 224» должно значить одно и то же независимо от
  // того, что выбрано сейчас, иначе цифры прыгают при каждом нажатии.
  const counts = useQuery((database) => presetCounts(database));
  const saved = useQuery((database) => listSavedFilters(database));

  const toggle = useCallback((preset: ProductPreset) => {
    setPresets((current) =>
      current.includes(preset)
        ? current.filter((item) => item !== preset)
        : [...current, preset],
    );
  }, []);

  return useMemo(
    () => ({
      presets,
      toggle,
      clear: () => setPresets([]),
      counts,
      active: presets.length,
      saved,
      apply: (filter: SavedFilter) => setPresets(filter.presets),
      save: (name: string) => {
        if (!name.trim() || presets.length === 0) return;
        saveFilter(db, { name: name.trim(), presets });
        refresh();
      },
      remove: (name: string) => {
        deleteFilter(db, name);
        refresh();
      },
      labels: presets.map((preset) => PRESET_LABEL[preset]),
    }),
    [presets, toggle, counts, saved, db, refresh],
  );
}

export { PRESETS, PRESET_LABEL };
export type { ProductPreset, SavedFilter };
