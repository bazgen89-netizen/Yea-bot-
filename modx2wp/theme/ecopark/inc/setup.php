<?php
/** Базовая настройка темы. */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'after_setup_theme', 'eco_setup' );
function eco_setup() {
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );

	register_nav_menus( array(
		'primary'      => 'Верхнее меню',
		'footer'       => 'Меню в подвале',
		'mobile_guest' => 'Мобильное меню — Гостям',
		'mobile_usl'   => 'Мобильное меню — Услуги',
		'mobile_park'  => 'Мобильное меню — Экопарк',
		'legal'        => 'Правовые ссылки в подвале',
	) );

	// Размеры под карточки исходной вёрстки.
	add_image_size( 'eco_card', 600, 400, true );   // анонсы услуг и событий
	add_image_size( 'eco_room', 800, 600, true );   // карточка коттеджа
	add_image_size( 'eco_slide', 1920, 1080, true ); // слайдеры
}

/**
 * Контактные данные вынесены из чанков MODX ($phone, $phonelink, адрес)
 * в настройки, чтобы менялись без правки кода: Настройки → Контакты.
 */
add_action( 'admin_menu', 'eco_contacts_menu' );
function eco_contacts_menu() {
	add_options_page( 'Контакты сайта', 'Контакты', 'manage_options', 'eco-contacts', 'eco_contacts_page' );
}

function eco_contact_defaults() {
	return array(
		'phone'      => '+7 (961) 253 27 57',
		'phone_link' => '+79612532757',
		'email'      => 'ecopark-33@yandex.ru',
		'address'    => 'п. Богослово, ул. Луговая, д. 45',
		'requisites' => 'ИП Рудник Михаил Дмитриевич | ИНН: 332763486189 | Время работы: Круглосуточно',
		'copyright'  => 'Официальный сайт - <br class="pr"/> Экопарк «Богослово» <br />@ Все права защищены / 2010-2026 /',
		'form_to'    => get_option( 'admin_email' ),
	);
}

function eco_contact( $key ) {
	$saved = get_option( 'eco_contacts', array() );
	$all   = array_merge( eco_contact_defaults(), is_array( $saved ) ? $saved : array() );
	return isset( $all[ $key ] ) ? $all[ $key ] : '';
}

add_action( 'admin_init', 'eco_contacts_register' );
function eco_contacts_register() {
	register_setting( 'eco_contacts_group', 'eco_contacts', array(
		'sanitize_callback' => 'eco_contacts_sanitize',
	) );
}

function eco_contacts_sanitize( $input ) {
	$out = array();
	foreach ( eco_contact_defaults() as $key => $default ) {
		$value = isset( $input[ $key ] ) ? $input[ $key ] : '';
		if ( 'copyright' === $key ) {
			$out[ $key ] = wp_kses( $value, array( 'br' => array( 'class' => array() ) ) );
		} elseif ( 'email' === $key || 'form_to' === $key ) {
			$out[ $key ] = sanitize_email( $value );
		} else {
			$out[ $key ] = sanitize_text_field( $value );
		}
	}
	return $out;
}

function eco_contacts_page() {
	$labels = array(
		'phone'      => 'Телефон (как показывать)',
		'phone_link' => 'Телефон для ссылки tel:',
		'email'      => 'E-mail',
		'address'    => 'Адрес',
		'requisites' => 'Реквизиты в подвале',
		'copyright'  => 'Копирайт (можно &lt;br&gt;)',
		'form_to'    => 'Куда слать заявки с форм',
	);
	?>
	<div class="wrap">
		<h1>Контакты сайта</h1>
		<form method="post" action="options.php">
			<?php settings_fields( 'eco_contacts_group' ); ?>
			<table class="form-table">
				<?php foreach ( $labels as $key => $label ) : ?>
					<tr>
						<th scope="row"><label for="eco-<?php echo esc_attr( $key ); ?>"><?php echo wp_kses_post( $label ); ?></label></th>
						<td>
							<input type="text" class="regular-text" id="eco-<?php echo esc_attr( $key ); ?>"
								name="eco_contacts[<?php echo esc_attr( $key ); ?>]"
								value="<?php echo esc_attr( eco_contact( $key ) ); ?>">
						</td>
					</tr>
				<?php endforeach; ?>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

/**
 * Тема маршрутизирует адреса сама (inc/permalinks.php), но при «простых»
 * постоянных ссылках WordPress отдаёт главную вместо 404 на любой
 * несуществующий путь. Предупреждаем, вместо того чтобы молча ломать SEO.
 */
add_action( 'admin_notices', 'eco_permalinks_notice' );
function eco_permalinks_notice() {
	if ( get_option( 'permalink_structure' ) || ! current_user_can( 'manage_options' ) ) {
		return;
	}
	printf(
		'<div class="notice notice-error"><p>%s <a href="%s">%s</a></p></div>',
		esc_html( 'Тема «ЭкоПарк» требует включённых постоянных ссылок: сейчас выбраны «Простые», из-за чего несуществующие адреса отдают главную страницу вместо 404.' ),
		esc_url( admin_url( 'options-permalink.php' ) ),
		esc_html( 'Настроить постоянные ссылки' )
	);
}
