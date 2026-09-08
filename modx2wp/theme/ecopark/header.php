<?php
/**
 * Шапка. Порт чанка `head` из MODX.
 *
 * Параметр &classes, который шаблоны передавали в чанк, здесь
 * вычисляется на месте: у коттеджей шапка всегда светлая, у остальных
 * зависит от поля pg_var.
 */

$eco_header_mode = eco_field( 'all_header_mode' ) ?: 'h2';
$eco_classes     = '';
if ( is_singular( 'cottage' ) || 'v2' === eco_field( 'pg_var' ) ) {
	$eco_classes = ' small black';
}
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?> class="no-js">
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="format-detection" content="telephone=no">
	<meta name="SKYPE_TOOLBAR" content="SKYPE_TOOLBAR_PARSER_COMPATIBLE">
	<meta name="language" content="russian">

	<link rel="icon" type="image/png" sizes="256x256" href="<?php echo esc_url( ECO_URI ); ?>/assets/favicon/256.png">
	<link rel="icon" type="image/png" sizes="192x192" href="<?php echo esc_url( ECO_URI ); ?>/assets/favicon/192.png">
	<link rel="icon" type="image/png" sizes="128x128" href="<?php echo esc_url( ECO_URI ); ?>/assets/favicon/128.png">
	<link rel="icon" type="image/png" sizes="96x96" href="<?php echo esc_url( ECO_URI ); ?>/assets/favicon/96.png">
	<link rel="icon" type="image/png" sizes="64x64" href="<?php echo esc_url( ECO_URI ); ?>/assets/favicon/64.png">
	<link rel="icon" type="image/png" sizes="32x32" href="<?php echo esc_url( ECO_URI ); ?>/assets/favicon/32.png">
	<link rel="icon" type="image/png" sizes="16x16" href="<?php echo esc_url( ECO_URI ); ?>/assets/favicon/16.png">

	<?php wp_head(); ?>

	<?php get_template_part( 'template-parts/travelline-head' ); ?>
	<?php get_template_part( 'template-parts/counters' ); ?>
</head>
<body <?php body_class(); ?>>

<?php get_template_part( 'template-parts/photoswipe' ); ?>
<?php get_template_part( 'template-parts/modals' ); ?>
<?php get_template_part( 'template-parts/mobile-menu' ); ?>

<div class="site">

	<div class="header<?php
		echo 'h2' === $eco_header_mode ? ' small' : '';
		echo 'h3' === $eco_header_mode ? ' small black' : '';
		echo esc_attr( $eco_classes );
	?>">

		<?php if ( in_array( $eco_header_mode, array( 'h2', 'h3' ), true ) ) : ?>
			<?php
			$eco_bg_mp = eco_image_url( 'all_header_imgmp' );
			$eco_bg_tp = eco_image_url( 'all_header_imgtp' );
			$eco_bg_dp = eco_image_url( 'all_header_imgdp' );
			?>
			<?php if ( $eco_bg_mp ) : ?>
				<div class="bg notp nodp" style="background-image:url(<?php echo esc_url( $eco_bg_mp ); ?>)"></div>
			<?php endif; ?>
			<?php if ( $eco_bg_tp ) : ?>
				<div class="bg nomp nodp" style="background-image:url(<?php echo esc_url( $eco_bg_tp ); ?>)"></div>
			<?php endif; ?>
			<div class="bg <?php echo $eco_bg_mp ? 'nomp' : ''; ?> <?php echo $eco_bg_tp ? 'notp' : ''; ?>" style="background-image:url(<?php echo esc_url( $eco_bg_dp ); ?>)"></div>
		<?php endif; ?>

		<div class="mmenu">
			<div class="in">
				<?php if ( is_front_page() ) : ?>
					<div class="mlogo"></div>
				<?php else : ?>
					<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="mlogo"></a>
				<?php endif; ?>

				<div class="ppmenubtnwr">
					<div class="ppmenubtn"><span></span></div>
				</div>

				<div class="menuwr">
					<?php
					wp_nav_menu( array(
						'theme_location' => 'primary',
						'container'      => false,
						'items_wrap'     => '<ul>%3$s</ul>',
						'depth'          => 1,
						'fallback_cb'    => false,
					) );
					?>
				</div>

				<div class="hcont">
					<div class="btnwr">
						<a class="btn<?php echo 'h3' === $eco_header_mode || str_contains( $eco_classes, 'black' ) ? ' brown' : ''; ?>"
							href="<?php echo esc_attr( eco_booking_url() ); ?>" data-tl-booking-open="true">Забронировать</a>
					</div>
					<div class="contwr">
						<div>
							<a class="htel" href="tel:<?php echo esc_attr( eco_contact( 'phone_link' ) ); ?>"><?php echo esc_html( eco_contact( 'phone' ) ); ?></a>
							<div class="w100"></div>
							<p><?php echo esc_html( eco_contact( 'address' ) ); ?></p>
						</div>
					</div>
				</div>
			</div>
		</div>

		<?php if ( 'h1' === $eco_header_mode ) : ?>
			<?php get_template_part( 'template-parts/home-slider' ); ?>
		<?php endif; ?>

	</div>
