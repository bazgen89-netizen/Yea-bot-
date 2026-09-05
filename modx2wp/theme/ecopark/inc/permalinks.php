<?php
/**
 * Сохранение адресов, доставшихся от MODX.
 *
 * На старом сайте схема смешанная: часть страниц — папками
 * (/uslugi/spa/ingalyaczii/), часть — файлами (/contacts.html,
 * /publication/ob-esoparke.html). Штатные правила WordPress так не умеют:
 * тип записи задаёт единый префикс и единый вид адреса.
 *
 * Поэтому точный путь хранится у каждой записи в поле `_eco_uri`,
 * а сопоставление «путь → запись» держится в опции `eco_uri_map`
 * и разбирается в parse_request. Это один запрос к опции вместо
 * нескольких сотен правил перезаписи, и адрес любой страницы можно
 * поменять руками, не трогая код.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const ECO_URI_META = '_eco_uri';
const ECO_URI_MAP  = 'eco_uri_map';

/** Путь записи без ведущего слэша: 'uslugi/spa/' или 'contacts.html'. */
function eco_get_uri( $post_id ) {
	$uri = get_post_meta( $post_id, ECO_URI_META, true );
	return is_string( $uri ) ? ltrim( $uri, '/' ) : '';
}

/** Путь по умолчанию для записи без явного `_eco_uri` — по слагам предков. */
function eco_default_uri( $post ) {
	$parts = array();
	foreach ( array_reverse( get_post_ancestors( $post ) ) as $ancestor_id ) {
		$parts[] = get_post_field( 'post_name', $ancestor_id );
	}
	$parts[] = $post->post_name;
	return implode( '/', array_filter( $parts ) ) . '/';
}

/* ------------------------------------------------------------------ *
 * Карта адресов
 * ------------------------------------------------------------------ */

function eco_build_uri_map() {
	$map = array();

	$posts = get_posts( array(
		'post_type'        => eco_post_types(),
		'post_status'      => array( 'publish', 'private', 'draft', 'pending', 'future' ),
		'numberposts'      => -1,
		'suppress_filters' => false,
		'fields'           => 'ids',
	) );

	$front_id = (int) get_option( 'page_on_front' );

	foreach ( $posts as $post_id ) {
		if ( $front_id && $front_id === (int) $post_id ) {
			continue; // главная живёт по адресу /
		}
		$uri = eco_get_uri( $post_id );
		if ( '' === $uri ) {
			$post = get_post( $post_id );
			if ( ! $post ) {
				continue;
			}
			$uri = eco_default_uri( $post );
		}
		$key = trim( $uri, '/' );
		if ( '' === $key ) {
			continue; // главная — её отдаёт front-page
		}
		// Первая запись выигрывает: дубль адреса виден в админке как предупреждение.
		if ( ! isset( $map[ $key ] ) ) {
			$map[ $key ] = array( 'id' => (int) $post_id, 'uri' => $uri );
		}
	}

	update_option( ECO_URI_MAP, $map, false );
	return $map;
}

function eco_uri_map() {
	$map = get_option( ECO_URI_MAP );
	if ( ! is_array( $map ) ) {
		$map = eco_build_uri_map();
	}
	return $map;
}

add_action( 'save_post', 'eco_flush_uri_map' );
add_action( 'deleted_post', 'eco_flush_uri_map' );
add_action( 'trashed_post', 'eco_flush_uri_map' );
add_action( 'untrashed_post', 'eco_flush_uri_map' );
function eco_flush_uri_map( $post_id = 0 ) {
	if ( $post_id && wp_is_post_revision( $post_id ) ) {
		return;
	}
	delete_option( ECO_URI_MAP );
}

/* ------------------------------------------------------------------ *
 * Отдача ссылок
 * ------------------------------------------------------------------ */

add_filter( 'post_type_link', 'eco_permalink', 10, 2 );
add_filter( 'page_link', 'eco_permalink', 10, 2 );
add_filter( 'post_link', 'eco_permalink', 10, 2 );
function eco_permalink( $url, $post ) {
	$post = get_post( $post );
	if ( ! $post || ! in_array( $post->post_type, eco_post_types(), true ) ) {
		return $url;
	}
	if ( (int) get_option( 'page_on_front' ) === (int) $post->ID ) {
		return home_url( '/' );
	}
	$uri = eco_get_uri( $post->ID );
	if ( '' === $uri ) {
		$uri = eco_default_uri( $post );
	}
	return home_url( '/' . $uri );
}

/* ------------------------------------------------------------------ *
 * Разбор запроса
 * ------------------------------------------------------------------ */

/**
 * Путь текущего запроса относительно корня сайта, без слэшей по краям.
 *
 * Намеренно не используем $wp->request: он заполняется только при
 * «красивых» ссылках, а тема должна вести себя одинаково при любых
 * настройках постоянных ссылок.
 */
function eco_request_path() {
	$path = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
	if ( ! is_string( $path ) ) {
		return '';
	}
	$path = urldecode( $path );

	// Учитываем установку в подкаталоге.
	$base = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
	if ( $base && '/' !== $base && str_starts_with( $path, $base ) ) {
		$path = substr( $path, strlen( $base ) );
	}
	return trim( $path, '/' );
}

add_action( 'parse_request', 'eco_parse_request' );
function eco_parse_request( $wp ) {
	if ( is_admin() ) {
		return;
	}

	$key = eco_request_path();
	if ( '' === $key ) {
		return;
	}
	$map = eco_uri_map();
	if ( ! isset( $map[ $key ] ) ) {
		return;
	}

	$post = get_post( $map[ $key ]['id'] );
	if ( ! $post ) {
		return;
	}

	$wp->query_vars = array(
		'p'         => $post->ID,
		'post_type' => $post->post_type,
	);
	if ( 'page' === $post->post_type ) {
		$wp->query_vars = array( 'page_id' => $post->ID );
	}
	$wp->matched_rule  = 'eco_uri_map';
	$wp->matched_query = 'p=' . $post->ID;

	// Наш адрес уже канонический — не давать WordPress его «чинить».
	remove_action( 'template_redirect', 'redirect_canonical' );

	// Слэш на конце должен совпадать с сохранённым видом адреса,
	// иначе один и тот же материал доступен по двум URL.
	eco_enforce_trailing_form( $map[ $key ]['uri'] );
}

function eco_enforce_trailing_form( $uri ) {
	$requested = eco_request_path();
	$expected  = trim( $uri, '/' );
	// Различаем только наличие слэша на конце, сам путь уже совпал.
	$has_slash = str_ends_with( $uri, '/' );
	$got_slash = str_ends_with( rtrim( urldecode( wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) ?: '' ) ), '/' );
	if ( $requested === $expected && $has_slash === $got_slash ) {
		return;
	}
	$expected = '/' . ltrim( $uri, '/' );
	$query = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_QUERY );
	wp_safe_redirect( home_url( $expected ) . ( $query ? '?' . $query : '' ), 301 );
	exit;
}

/* ------------------------------------------------------------------ *
 * Редиректы со старых адресов, которых больше нет
 * ------------------------------------------------------------------ */

add_action( 'template_redirect', 'eco_legacy_redirects', 5 );
function eco_legacy_redirects() {
	if ( ! is_404() ) {
		return;
	}
	$path = eco_request_path();
	if ( '' === $path ) {
		return;
	}

	$rules = get_option( 'eco_redirects', array() );
	if ( is_array( $rules ) && isset( $rules[ $path ] ) ) {
		wp_safe_redirect( home_url( '/' . ltrim( $rules[ $path ], '/' ) ), 301 );
		exit;
	}

	// MODX отдавал страницы и по числовому id — /?id=42 и /42.html.
	if ( preg_match( '~^(\d+)\.html$~', $path, $m ) ) {
		$post_id = eco_find_by_modx_id( (int) $m[1] );
		if ( $post_id ) {
			wp_safe_redirect( get_permalink( $post_id ), 301 );
			exit;
		}
	}
}

/** Ищет запись по её прежнему id в MODX (сохраняется миграцией). */
function eco_find_by_modx_id( $modx_id ) {
	$found = get_posts( array(
		'post_type'   => eco_post_types(),
		'post_status' => 'any',
		'numberposts' => 1,
		'fields'      => 'ids',
		'meta_key'    => '_eco_modx_id',
		'meta_value'  => (int) $modx_id,
	) );
	return $found ? (int) $found[0] : 0;
}

/**
 * Нормализация схемы внутренних ссылок в контенте.
 *
 * Страницы импортировались, когда адрес сайта в WordPress был https, поэтому
 * абсолютные ссылки внутри контента (Контактная информация, «Подробнее» и
 * т. п.) забились как https://bogoslovo.beget.tech/... На техническом
 * поддомене SSL-сертификата нет, и переход по такой ссылке обрывается
 * (ERR_CONNECTION_CLOSED) — страница выглядит недоступной.
 *
 * Приводим схему ссылок на хост сайта к текущей (http на поддомене без SSL,
 * https — когда сайт откроется по защищённому боевому домену). Правка
 * делается на выводе и не меняет сохранённый контент.
 */
function eco_normalize_link_scheme( $html ) {
	if ( ! is_string( $html ) || '' === $html ) {
		return $html;
	}
	$host = wp_parse_url( home_url( '/' ), PHP_URL_HOST );
	if ( ! $host ) {
		return $html;
	}
	$scheme = is_ssl() ? 'https' : 'http';
	$wrong  = ( 'https' === $scheme ) ? 'http' : 'https';
	return str_ireplace( $wrong . '://' . $host, $scheme . '://' . $host, $html );
}
/*
 * Ссылки на хост сайта встречаются не только в контенте, но и в меню,
 * подвале и других местах шаблона. Чтобы поправить их все разом, чиним
 * схему на выводе всей страницы через буфер. Правка касается только
 * хоста сайта и не трогает внешние ссылки.
 */
add_action( 'template_redirect', 'eco_start_scheme_buffer', 1 );
function eco_start_scheme_buffer() {
	if ( is_admin() ) {
		return;
	}
	ob_start( 'eco_page_output_filter' );
}

/**
 * Единый фильтр вывода страницы: чинит схему внутренних ссылок и
 * подменяет сломанный загрузчик ленты на страницах-списках.
 */
function eco_page_output_filter( $html ) {
	$orig = $html;
	$html = eco_normalize_link_scheme( $html );
	if ( function_exists( 'eco_fix_feed_loader' ) ) {
		$html = eco_fix_feed_loader( $html );
	}
	// Страховка: при любой неожиданной пустоте отдаём исходную страницу.
	if ( ! is_string( $html ) || '' === $html ) {
		return $orig;
	}
	return $html;
}
