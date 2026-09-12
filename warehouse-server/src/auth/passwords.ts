import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** promisify(scrypt) теряет перегрузку с параметрами — оборачиваем вручную. */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/**
 * scrypt из стандартной библиотеки Node вместо bcrypt/argon2: нативных
 * зависимостей нет, а стойкость к перебору сопоставима.
 *
 * Параметры — рекомендованные (N=2^15). Хеш хранится строкой
 * `scrypt$N$r$p$соль$хеш`, чтобы старые хеши остались проверяемыми, когда
 * параметры со временем ужесточат.
 */
const N = 32_768;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
// scrypt требует 128 * N * r байт = 32 МиБ, а лимит Node по умолчанию ровно
// 32 МиБ и срабатывает на границе. Поднимаем явно — на результат хеша
// параметр не влияет, он только снимает предохранитель.
const MAX_MEM = 128 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEM });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  const salt = Buffer.from(saltRaw, 'base64');
  const expected = Buffer.from(keyRaw, 'base64');

  const actual = await scryptAsync(password, salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: MAX_MEM,
  });

  // Сравнение за постоянное время: обычное === утекает длину общего префикса.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Минимальные требования к паролю. Возвращает текст ошибки или null. */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Пароль должен быть не короче 8 символов';
  if (password.length > 200) return 'Пароль слишком длинный';
  return null;
}
