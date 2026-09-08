<?php
/**
 * Заголовочный блок страницы. Порт ветвлений [[!If]] из шаблонов
 * «Стандартная страница», «Услуги» и «Страница событий»:
 *   v1 — тёмный блок с текстом
 *   v2 — светлый блок со слайдером
 */

$eco_var = eco_field( 'pg_var' );
$eco_pre = eco_field( 'pg_toppre' );
$eco_top = eco_field( 'pg_topcont' );

if ( 'v1' === $eco_var ) : ?>
	<div class="restaurant">
		<div class="halign">
			<div class="top<?php echo eco_flag( 'pg_nobg' ) ? ' nobg' : ''; ?>">
				<?php if ( $eco_pre ) : ?>
					<p class="pre"><?php echo esc_html( $eco_pre ); ?></p>
				<?php endif; ?>
				<h1><?php echo eco_title_html( eco_long_title() ); ?></h1>
				<?php if ( is_singular( 'event' ) && eco_field( 'ev_dat' ) ) : ?>
					<p class="dat">Дата проведения: <?php echo esc_html( eco_field( 'ev_dat' ) ); ?></p>
				<?php endif; ?>
				<?php echo eco_field_html( $eco_top ); ?>
			</div>
		</div>
	</div>
	<div class="mt-100"></div>

<?php elseif ( 'v2' === $eco_var ) : ?>
	<div class="roomheader">
		<div class="halign">
			<div class="topsld">
				<?php eco_the_slider( 'pg_topslider' ); ?>
				<div class="txt">
					<?php if ( $eco_pre ) : ?>
						<p class="pre"><?php echo esc_html( $eco_pre ); ?></p>
					<?php endif; ?>
					<h1><?php echo eco_title_html( eco_long_title() ); ?></h1>
					<?php if ( is_singular( 'event' ) && eco_field( 'ev_dat' ) ) : ?>
						<p class="dat">Дата проведения: <?php echo esc_html( eco_field( 'ev_dat' ) ); ?></p>
					<?php endif; ?>
					<?php echo eco_field_html( $eco_top ); ?>
				</div>
			</div>
		</div>
	</div>
<?php endif; ?>
