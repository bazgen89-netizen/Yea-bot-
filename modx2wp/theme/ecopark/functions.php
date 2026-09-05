<?php
/**
 * ЭкоПарк Богослово — точка входа темы.
 *
 * Порт с MODX Revolution 3.0.3. Соответствие сущностей:
 *   шаблон MODX          -> шаблон темы
 *   Главная страница     -> front-page.php
 *   Номерной фонд        -> single-cottage.php
 *   Услуги               -> single-service.php
 *   Страница событий     -> single-event.php
 *   Стандартная страница -> page.php
 *   чанк head            -> header.php
 *   чанк footer          -> footer.php
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ECO_VERSION', '1.0.8' );
define( 'ECO_DIR', get_template_directory() );
define( 'ECO_URI', get_template_directory_uri() );

require_once ECO_DIR . '/inc/setup.php';
require_once ECO_DIR . '/inc/no-cache.php';
require_once ECO_DIR . '/inc/assets.php';
require_once ECO_DIR . '/inc/post-types.php';
require_once ECO_DIR . '/inc/meta-boxes.php';
require_once ECO_DIR . '/inc/fields.php';
require_once ECO_DIR . '/inc/permalinks.php';
require_once ECO_DIR . '/inc/template-tags.php';
require_once ECO_DIR . '/inc/seo.php';
require_once ECO_DIR . '/inc/sitemap.php';
require_once ECO_DIR . '/inc/robots.php';
require_once ECO_DIR . '/inc/importer.php';

if ( is_admin() ) {
	require_once ECO_DIR . '/inc/admin-import.php';
}
require_once ECO_DIR . '/inc/forms.php';
require_once ECO_DIR . '/inc/shortcodes.php';
