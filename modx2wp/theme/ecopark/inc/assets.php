<?php
/**
 * Подключение стилей и скриптов.
 * Порядок и состав повторяют чанк `head` из MODX один-в-один —
 * от него зависит каскад стилей и порядок инициализации скриптов.
 * theme.css (перенесённые инлайновые стили) грузится последним,
 * после newstyle.css, чтобы сохранить исходный приоритет.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'wp_enqueue_scripts', 'eco_assets' );
function eco_assets() {
	// Порядок CSS — как на исходном сайте.
	$css = array(
		'default-skin',
		'photoswipe',
		'jquery-ui.theme.min',
		'jquery-ui.structure.min',
		'jquery-ui.min',
		'responsiveslides',
		'normalize5.min',
		'swiper.min',
		'style',
		'main',
		'temp',
		'newstyle',
		'theme',
	);
	$prev = null;
	foreach ( $css as $handle ) {
		$slug = 'eco-' . sanitize_title( $handle );
		wp_enqueue_style( $slug, ECO_URI . "/assets/css/{$handle}.css", $prev ? array( $prev ) : array(), ECO_VERSION );
		$prev = $slug;
	}

	// Тема приехала с jQuery 1.11 и на нём завязаны slimscroll, jquery-ui,
	// fancybox, cookie и script.js. Ядровый jQuery 3.x ломает часть кода,
	// поэтому оставляем родную версию под стандартным хэндлом 'jquery'.
	wp_deregister_script( 'jquery' );
	wp_register_script( 'jquery', ECO_URI . '/assets/js/jquery-1.11.1.min.js', array(), '1.11.1', false );
	wp_enqueue_script( 'jquery' );

	wp_enqueue_script( 'eco-ymaps', 'https://api-maps.yandex.ru/2.1.11/?lang=ru_RU', array(), null, false );

	// Порядок JS — как на исходном сайте. Каждый скрипт зависит от предыдущего,
	// чтобы WordPress вывел их ровно в этой последовательности.
	$js = array(
		'jquery.slimscroll.min',
		'jquery-ui.min',
		'responsiveslides.min',
		'swiper.min',
		'perfect-scrollbar.min',
		'spgradient',
		'photoswipe-ui-default.min',
		'photoswipe.min',
		'spmain.min',
		'jquery.fancybox.min',
		'jquery.cookie',
		'spanimotion',
		'script',
		'html5-3.6-respond-1.1.0.min',
	);
	$dep = 'jquery';
	foreach ( $js as $handle ) {
		$slug = 'eco-' . sanitize_title( $handle );
		wp_enqueue_script( $slug, ECO_URI . "/assets/js/{$handle}.js", array( $dep ), ECO_VERSION, false );
		$dep = $slug;
	}
}

/**
 * Исходная вёрстка построена на <base href="/"> и относительных путях.
 * На <base> завязаны якорные ссылки в script.js, поэтому оставляем его.
 */
add_action( 'wp_head', 'eco_base_tag', 1 );
function eco_base_tag() {
	echo '<base href="' . esc_url( home_url( '/' ) ) . '">' . "\n";
}
