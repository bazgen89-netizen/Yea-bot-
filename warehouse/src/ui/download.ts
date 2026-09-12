import { Platform } from 'react-native';

import { say } from './alert';

/**
 * Отдать пользователю файл.
 *
 * В браузере это скачивание, на телефоне — системное «Поделиться»: сохранить
 * файл в папку и сказать «он в кэше» на телефоне бесполезно, туда никто не
 * ходит. Половинки разные, а зовут их одинаково — экраны про это не думают.
 *
 * Нативные модули подгружаются по требованию: `expo-file-system` в вебе
 * не работает, и статический импорт утащил бы его в браузерный бандл.
 */
export async function saveFile(
  name: string,
  contents: string | Uint8Array,
  mimeType: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    saveInBrowser(name, contents, mimeType);
    return;
  }

  try {
    const { File, Paths } = await import('expo-file-system');
    const Sharing = await import('expo-sharing');

    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    // Двоичное пишется как есть, текст — как текст: у выгрузки базы иначе
    // побьётся каждый байт, не попавший в UTF-8.
    if (typeof contents === 'string') file.write(contents);
    else file.write(contents);

    if (!(await Sharing.isAvailableAsync())) {
      say('Не получится поделиться', `Файл сохранён: ${file.uri}`);
      return;
    }
    await Sharing.shareAsync(file.uri, { mimeType });
  } catch (error) {
    say('Не удалось сохранить файл', String(error));
  }
}

/**
 * Спросить файл у пользователя. Пока только в браузере: на телефоне нужен
 * `expo-document-picker`, а восстановление там ещё не сделано, и возвращать
 * выбранный файл было бы некуда.
 */
export async function pickFile(accept: string): Promise<Uint8Array | null> {
  if (Platform.OS !== 'web') {
    say('Пока только в браузере', 'Восстановление из копии работает в веб-версии.');
    return null;
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? new Uint8Array(await file.arrayBuffer()) : null);
      input.remove();
    };
    // Отмену в диалоге выбора файла браузер сообщает не всем: если событие
    // не пришло, обещание останется висеть, но ничего и не произойдёт.
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

function saveInBrowser(name: string, contents: string | Uint8Array, mimeType: string): void {
  const blob = new Blob([contents as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Ссылка на объект держит его в памяти, пока её не отпустят. Не сразу:
  // Safari успевает начать скачивание уже после возврата из click().
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
