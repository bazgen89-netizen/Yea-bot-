<?php
/**
 * Мета-теги страницы. Порт чанка `head`.
 *
 * На старом сайте <title>, description, robots и og-теги собирались
 * прямо в чанке из полей ресурса. Здесь то же самое, один в один:
 * заголовок без суффикса с названием сайта, description из поля
 * ресурса, robots из бывшего TV index_page.
 *
 * Если позже поставят SEO-плагин (Yoast, Rank Math, SEOPress, All in One),
 * тема отдаёт эти теги ему и молчит — иначе на странице окажется
 * по два description и два canonical.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Стоит ли SEO-плагин, который сам выводит мета-теги. */
function eco_seo_plugin_active() {
	return defined( 'WPSEO_VERSION' )        // Yoast
		|| defined( 'RANK_MATH_VERSION' )    // Rank Math
		|| defined( 'SEOPRESS_VERSION' )     // SEOPress
		|| defined( 'AIOSEO_VERSION' );      // All in One SEO
}

/**
 * Заголовок без хвоста «— Название сайта».
 * На старом сайте <title> был равен полю pagetitle, и такие заголовки
 * уже проиндексированы — менять их при переносе нельзя.
 */
add_filter( 'document_title_parts', 'eco_document_title_parts' );
function eco_document_title_parts( $parts ) {
	if ( eco_seo_plugin_active() ) {
		return $parts;
	}
	unset( $parts['site'], $parts['tagline'] );
	return $parts;
}

add_filter( 'document_title_separator', function ( $sep ) {
	return eco_seo_plugin_active() ? $sep : '';
} );

/** Описание страницы: бывшее поле description ресурса MODX. */
function eco_meta_description( $post_id = null ) {
	$post_id = $post_id ?: get_the_ID();
	// Только своё поле. Анонс сюда подставлять нельзя: в MODX
	// description брался ровно из одноимённого поля ресурса, а introtext
	// у некоторых страниц содержит служебный код.
	$value = get_post_meta( $post_id, '_eco_description', true );
	return trim( wp_strip_all_tags( (string) $value ) );
}

/** Правило индексации: бывший TV index_page. */
function eco_meta_robots( $post_id = null ) {
	$post_id = $post_id ?: get_the_ID();
	$value   = get_post_meta( $post_id, 'index_page', true );
	return $value ?: 'index, follow';
}

add_action( 'wp_head', 'eco_head_meta', 1 );
function eco_head_meta() {
	if ( eco_seo_plugin_active() || ! is_singular() ) {
		return;
	}

	$description = eco_meta_description();
	$title       = get_the_title();
	$url         = eco_canonical_url();

	printf( '<meta name="robots" content="%s">' . "\n", esc_attr( eco_meta_robots() ) );
	if ( $description ) {
		printf( '<meta name="description" content="%s">' . "\n", esc_attr( $description ) );
	}

	echo '<meta property="og:locale" content="ru_RU">' . "\n";
	echo '<meta property="og:type" content="website">' . "\n";
	printf( '<meta property="og:title" content="%s">' . "\n", esc_attr( $title ) );
	if ( $description ) {
		printf( '<meta property="og:description" content="%s">' . "\n", esc_attr( $description ) );
	}
	printf( '<meta property="og:url" content="%s">' . "\n", esc_url( $url ) );
	printf( '<meta property="og:site_name" content="%s">' . "\n", esc_attr( get_bloginfo( 'name' ) ) );

	$image = eco_og_image();
	if ( $image ) {
		printf( '<meta property="og:image" content="%s">' . "\n", esc_url( $image ) );
	}
}

/** Картинка для соцсетей: анонс записи, иначе фон шапки. */
function eco_og_image() {
	foreach ( array( 'nomera_animg', 'usl_animg', 'ev_animg', 'all_header_imgdp' ) as $field ) {
		$url = eco_image_url( $field );
		if ( $url ) {
			return $url;
		}
	}
	return '';
}

/**
 * Канонический адрес отдаём один раз. Ядро WordPress строит его по
 * своим правилам постоянных ссылок и не знает про карту адресов темы,
 * поэтому подменяем его, а не добавляем второй тег.
 */
remove_action( 'wp_head', 'rel_canonical' );
add_action( 'wp_head', 'eco_rel_canonical', 2 );
function eco_rel_canonical() {
	if ( eco_seo_plugin_active() ) {
		rel_canonical();
		return;
	}
	printf( '<link rel="canonical" href="%s">' . "\n", esc_url( eco_canonical_url() ) );
}

/** Подтверждения прав в поисковиках — были прописаны в чанке `head`. */
add_action( 'wp_head', 'eco_verification_meta', 3 );
function eco_verification_meta() {
	if ( ! is_front_page() ) {
		return;
	}
	echo '<meta name="yandex-verification" content="c3aa78264d1d629a">' . "\n";
	echo '<meta name="google-site-verification" content="7_-DzSc8ilnJqXvpvxPAZzO2SyTaI1GEVn1hWO9MDdw">' . "\n";
	echo '<meta name="msvalidate.01" content="0FBC693C58B2DB0E988C25C09D9E8354">' . "\n";
}

/**
 * Отключаем «умную типографику» WordPress.
 *
 * wptexturize подменяет дефис на длинное тире, а прямые кавычки — на
 * ёлочки. MODX отдавал разметку как есть, поэтому такая замена — это
 * расхождение с уже проиндексированными заголовками (например
 * «Сосновый - Коттедж» превращался в «Сосновый — Коттедж»).
 * Хуже того, она portит кавычки внутри inline-скриптов в тексте страниц.
 */
foreach ( array( 'the_title', 'the_content', 'the_excerpt', 'widget_text_content',
	'single_post_title', 'document_title', 'wp_title' ) as $eco_filter ) {
	remove_filter( $eco_filter, 'wptexturize' );
}

/**
 * Заголовок главной страницы берём у самой страницы, а не у сайта:
 * в MODX <title> главной был длинным SEO-заголовком ресурса.
 */
add_filter( 'document_title_parts', 'eco_front_page_title', 20 );
function eco_front_page_title( $parts ) {
	if ( eco_seo_plugin_active() || ! is_front_page() ) {
		return $parts;
	}
	$front_id = (int) get_option( 'page_on_front' );
	if ( $front_id ) {
		$parts['title'] = get_post_field( 'post_title', $front_id );
	}
	return $parts;
}
