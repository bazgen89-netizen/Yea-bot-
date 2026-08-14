import { useEffect, useRef, type ReactNode } from 'react';
import { useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { WebIcon } from '../ui/icons';
import {
  FORM_BORDER,
  FORM_GAP,
  FORM_INPUT_HEIGHT,
  FORM_LABEL,
  web,
  WEB_FONT,
} from '../ui/webTheme';

/**
 * Части формы кабинета.
 *
 * Оригинал собран на Semantic UI, и его форма — не набор карточек, а один
 * лист: заголовок раздела, поля под ним, тонкая линия, следующий заголовок.
 * Раньше карточка товара была сделана двумя колонками из блоков с рамками —
 * это выглядело аккуратно, но у него так не выглядит ни один экран, и
 * переучиваться пришлось бы на каждом поле.
 *
 * Размеры и цвета — из его таблицы стилей, см. `webTheme`. Здесь только
 * разметка.
 */

/** Лист формы: белый, отступы `.panel` — 35 сверху и снизу, 100 по бокам. */
export function FormPanel({ children }: { children: ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

/** Заголовок раздела — `h3`, 18 пикселей начертанием 700. */
export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

/** Линия между разделами — `.ui.divider`. */
export function Divider() {
  return <View style={styles.divider} />;
}

/**
 * Поле: подпись и то, что под ней.
 *
 * `action` — ссылка справа от подписи: у него так сделаны «Сгенерировать»
 * и «Получить из штрих-кода», и обе стоят именно в подписи, а не рядом с
 * полем.
 */
export function Field({
  label,
  action,
  onAction,
  hint,
  children,
  half,
  third,
}: {
  label?: string;
  action?: string;
  onAction?: () => void;
  hint?: string;
  children: ReactNode;
  half?: boolean;
  third?: boolean;
}) {
  return (
    <View style={[styles.field, half && styles.half, third && styles.third]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {action ? (
            <Text
              accessibilityRole="link"
              style={styles.action}
              onPress={onAction}
            >
              ({action})
            </Text>
          ) : null}
        </View>
      ) : null}

      {children}

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Строка полей — `.ui.fields`: поля рядом, между ними 14. */
export function Fields({ children }: { children: ReactNode }) {
  return <View style={styles.fields}>{children}</View>;
}

/**
 * Поле ввода.
 *
 * `unit` — приписка справа внутри рамки: рубль у цены, процент у наценки,
 * «шт» у количества. У него это `.ui.right.labeled.input`, и без неё в
 * блоке цен непонятно, где проценты, а где деньги.
 */
export function TextBox({
  value,
  onChange,
  placeholder,
  unit,
  numeric,
  multiline,
  maxLength,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  unit?: string;
  numeric?: boolean;
  multiline?: boolean;
  maxLength?: number;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <View style={styles.inputRow}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={web.textMuted}
        editable={!disabled}
        multiline={multiline}
        maxLength={maxLength}
        accessibilityLabel={label}
        style={[
          styles.input,
          multiline && styles.textarea,
          numeric && styles.numeric,
          unit ? styles.inputWithUnit : null,
          disabled && styles.inputDisabled,
        ]}
      />
      {unit ? (
        <View style={styles.unit}>
          <Text style={styles.unitText}>{unit}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Переключатель — `.ui.toggle.checkbox`.
 *
 * Подпись бывает в две строки: сверху что включаем, снизу мелким — что от
 * этого изменится. Вторая строка не украшение: «Установить разные цены
 * продажи в магазинах» без неё не объясняет, что товар начнёт продаваться
 * по цене магазина.
 */
export function Toggle({
  on,
  onChange,
  label,
  hint,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  /**
   * Ползунок ездит, а не перескакивает.
   *
   * Раньше кружок менял отступ разом, и переключатель отвечал рывком: по
   * такому не видно, что он вообще переключился, — глазу нужно движение.
   */
  const slide = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: on ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      // Цвет дорожки анимируется вместе с кружком, а такое умеет только
      // родной драйвер выключённым.
      useNativeDriver: false,
    }).start();
  }, [on, slide]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      onPress={() => !disabled && onChange(!on)}
      style={[styles.toggleRow, disabled && styles.toggleDisabled]}
    >
      <Animated.View
        style={[
          styles.track,
          {
            backgroundColor: slide.interpolate({
              inputRange: [0, 1],
              outputRange: ['rgba(0,0,0,0.05)', web.link],
            }),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.knob,
            { transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 28] }) }] },
          ]}
        />
      </Animated.View>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

/**
 * Несколько значений одним полем: категории товара.
 *
 * Ввели новое и нажали Enter — оно добавилось; нажали на крестик — убралось.
 * Так это устроено у него («Выберите из списка или введите новую и нажмите
 * Enter»), и это единственный способ завести категорию, не уходя со страницы.
 */
export function Chips({
  values,
  options,
  onChange,
  placeholder,
}: {
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  // Список раскрыт. Открывается по нажатию на поле и по стрелке справа: у него
  // категорию выбирают из готовых, а не набирают по памяти — набор нужен
  // только тогда, когда такой категории ещё нет.
  const [open, setOpen] = useState(false);

  const add = (name: string) => {
    const clean = name.trim();
    // Повтор не добавляется: две одинаковые категории у товара — это не
    // «дважды», а мусор в списке и в отчёте по категориям.
    if (clean && !values.some((item) => item.toLowerCase() === clean.toLowerCase())) {
      onChange([...values, clean]);
    }
    setDraft('');
  };

  const left = options.filter(
    (option) =>
      !values.some((item) => item.toLowerCase() === option.toLowerCase()) &&
      option.toLowerCase().includes(draft.trim().toLowerCase()),
  );

  return (
    <View>
      <View style={styles.chips}>
        {values.map((item) => (
          <View key={item} style={styles.chip}>
            <Text style={styles.chipText}>{item}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Убрать ${item}`}
              onPress={() => onChange(values.filter((value) => value !== item))}
            >
              <WebIcon.close size={12} color={web.textMuted} />
            </Pressable>
          </View>
        ))}

        <TextInput
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onSubmitEditing={() => add(draft)}
          placeholder={values.length === 0 ? placeholder : ''}
          placeholderTextColor={web.textMuted}
          style={styles.chipInput}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Свернуть список' : 'Показать список'}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((current) => !current)}
          hitSlop={8}
        >
          {open ? (
            <WebIcon.chevronUp size={16} color={web.textMuted} />
          ) : (
            <WebIcon.chevronDown size={16} color={web.textMuted} />
          )}
        </Pressable>
      </View>

      {open ? (
        <View style={styles.suggest}>
          {left.slice(0, 12).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              onPress={() => {
                add(option);
                setOpen(false);
              }}
              style={(state) => [
                styles.suggestItem,
                (state as { hovered?: boolean }).hovered && styles.suggestHover,
              ]}
            >
              <Text style={styles.suggestText}>{option}</Text>
            </Pressable>
          ))}

          {/* Новая категория заводится тут же — но отдельной строкой, а не
              молча по Enter: видно, что она новая, а не выбрана из списка. */}
          {draft.trim() && !options.some((o) => o.toLowerCase() === draft.trim().toLowerCase()) ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                add(draft);
                setOpen(false);
              }}
              style={styles.suggestItem}
            >
              <Text style={styles.suggestNew}>Создать «{draft.trim()}»</Text>
            </Pressable>
          ) : null}

          {left.length === 0 && !draft.trim() ? (
            <Text style={styles.suggestEmpty}>
              {options.length === 0
                ? 'Категорий пока нет — наберите название, чтобы завести первую'
                : 'Все категории уже выбраны'}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Ссылка-действие внутри формы: «Добавить упаковку», «Добавить PLU код». */
export function FormLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Text accessibilityRole="link" style={styles.formLink} onPress={onPress}>
      {label}
    </Text>
  );
}

/**
 * Подсказка в рамке — `.ui.icon.message`.
 *
 * Их пояснения про себестоимость по среднему перенесены дословно: они
 * объясняют не кнопку, а модель — почему себестоимость нельзя просто
 * вписать, и почему правка остатка не меняет её.
 */
export function Notice({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.notice}>
      <WebIcon.info size={16} color={web.link} />
      <View style={styles.noticeText}>
        {title ? <Text style={styles.noticeTitle}>{title}</Text> : null}
        <Text style={styles.noticeBody}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#FFFFFF', paddingVertical: 35, paddingHorizontal: 100 },
  heading: {
    fontFamily: WEB_FONT,
    fontSize: 18,
    fontWeight: '700',
    color: web.text,
    marginTop: 26,
    marginBottom: FORM_GAP,
  },
  divider: { height: 1, backgroundColor: 'rgba(34,36,38,0.15)', marginVertical: FORM_GAP },

  field: { marginBottom: FORM_GAP },
  fields: { flexDirection: 'row', gap: FORM_GAP },
  half: { flex: 1 },
  third: { flex: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  label: { fontFamily: WEB_FONT, fontSize: 13, fontWeight: '700', color: FORM_LABEL },
  action: { fontFamily: WEB_FONT, fontSize: 13, color: web.link },
  hint: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted, marginTop: 4, lineHeight: 17 },

  inputRow: { flexDirection: 'row', alignItems: 'stretch' },
  input: {
    flex: 1,
    height: FORM_INPUT_HEIGHT,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 14,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    backgroundColor: '#FFFFFF',
  },
  inputWithUnit: { borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 },
  inputDisabled: { backgroundColor: '#FAFAFA', color: web.textMuted },
  textarea: { height: 84, paddingTop: 9, textAlignVertical: 'top' },
  numeric: { textAlign: 'right' },
  unit: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  unitText: { fontFamily: WEB_FONT, fontSize: 14, color: 'rgba(0,0,0,0.6)' },

  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  toggleDisabled: { opacity: 0.5 },
  // 49 × 21 — `3.5rem × 1.5rem` при базе 14.
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.05)' },

  knob: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
  },

  toggleText: { flex: 1 },
  toggleLabel: { fontFamily: WEB_FONT, fontSize: 14, color: FORM_LABEL, lineHeight: 21 },
  toggleHint: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted, lineHeight: 17 },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    minHeight: FORM_INPUT_HEIGHT,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: '#FFFFFF',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#E8E8E8',
  },
  chipText: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  chipInput: {
    flex: 1,
    minWidth: 140,
    height: 26,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  suggest: {
    marginTop: 4,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  suggestItem: { paddingHorizontal: 12, paddingVertical: 9 },
  suggestHover: { backgroundColor: web.rowHover },
  suggestText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  suggestNew: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },
  suggestEmpty: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, padding: 12 },

  formLink: { fontFamily: WEB_FONT, fontSize: 13, color: web.link },

  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 4,
    backgroundColor: '#F8F8F9',
  },
  noticeText: { flex: 1, gap: 3 },
  noticeTitle: { fontFamily: WEB_FONT, fontSize: 13, fontWeight: '700', color: FORM_LABEL },
  noticeBody: { fontFamily: WEB_FONT, fontSize: 13, color: 'rgba(0,0,0,0.68)', lineHeight: 19 },
});
