import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Translated';

import { WebIcon } from '../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../ui/webTheme';

/**
 * Карточки — так в кабинете показаны счета, магазины и сотрудники.
 *
 * Не таблицей: у этих трёх справочников по три-четыре записи и по пять полей
 * в каждой. Таблица на четыре строки — это шапка, под которой почти ничего
 * нет, и половина ширины экрана под колонку «Создан».
 *
 * Первая карточка всегда пунктирная «Создать»: заводить их приходится
 * поштучно и редко, и отдельная кнопка на панели была бы дальше от того
 * места, куда смотрят.
 */

export function CardGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function CreateCard({ onPress, label = 'Создать' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.card, styles.dashed]}
    >
      <View style={styles.createInner}>
        <Text style={styles.createLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** Строка описания карточки: значок и текст. */
export function CardLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.line}>
      <View style={styles.lineIcon}>{icon}</View>
      <Text style={styles.lineText} numberOfLines={2}>
        {children}
      </Text>
    </View>
  );
}

export function Card({
  icon,
  title,
  onOpen,
  ribbon,
  label,
  lines,
  onEdit,
  onDelete,
  footer,
}: {
  icon: ReactNode;
  title: string;
  onOpen?: () => void;
  /** Уголок с галочкой — «по умолчанию». */
  ribbon?: boolean;
  /** Ярлык сверху: тип счёта. */
  label?: string;
  lines: ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Что показать вместо кнопок правки: «Восстановить» у уволенных. */
  footer?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      {label ? (
        <View style={styles.topLabel}>
          <Text style={styles.topLabelText}>{label}</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        {ribbon ? (
          <View style={styles.ribbon}>
            <WebIcon.done size={13} color="#FFFFFF" />
          </View>
        ) : null}

        <View style={styles.head}>
          <View style={styles.icon}>{icon}</View>
          <View style={styles.headText}>
            <Text
              accessibilityRole={onOpen ? 'link' : undefined}
              onPress={onOpen}
              style={[styles.title, onOpen && styles.titleLink]}
              numberOfLines={2}
            >
              {title}
            </Text>
          </View>
        </View>

        <View style={styles.lines}>{lines}</View>
      </View>

      {footer ? (
        <View style={styles.extra}>{footer}</View>
      ) : onEdit || onDelete ? (
        <View style={styles.extra}>
          {onEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Изменить: ${title}`}
              onPress={onEdit}
              style={[styles.button, styles.editButton]}
            >
              <WebIcon.pencil size={14} color={web.greenText} />
              <Text style={styles.editLabel}>Изменить</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Удалить: ${title}`}
              onPress={onDelete}
              style={[styles.button, styles.deleteButton]}
            >
              <WebIcon.trash size={14} color={web.danger} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Сообщение над карточками: «Баланс …», «Всего 5 сотрудников». */
export function CardsNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },

  card: {
    // Две карточки в ряд — его сетка `ui two cards`.
    width: 420,
    maxWidth: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  dashed: {
    borderStyle: 'dashed',
    borderColor: '#C8CCD0',
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createInner: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  createLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },

  topLabel: {
    backgroundColor: '#F3F4F5',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  topLabelText: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },

  body: { padding: 16, gap: 10 },
  ribbon: {
    position: 'absolute',
    left: 0,
    top: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: web.green,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 26 },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#F3F4F5',
  },
  headText: { flex: 1 },
  title: { fontFamily: WEB_FONT, fontSize: 17, color: web.text },
  titleLink: { color: web.link },

  lines: { gap: 6, paddingLeft: 26 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineIcon: { width: 16, alignItems: 'center', paddingTop: 2 },
  lineText: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  extra: {
    flexDirection: 'row',
    gap: 6,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  button: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 4,
  },
  editButton: { flex: 1, borderColor: web.green },
  editLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.greenText },
  deleteButton: { width: 46, borderColor: web.danger },

  notice: {
    backgroundColor: '#F8F8F9',
    borderRadius: 4,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 6,
  },
  noticeTitle: { fontFamily: WEB_FONT, fontSize: 16, color: web.text, fontWeight: '700' },
});
