<?php
/**
 * Коттедж. Порт шаблона MODX «Номерной фонд».
 * Шапка здесь всегда светлая, поэтому header.php сам добавляет
 * класс small black — поле pg_var у этого типа не участвует.
 */
get_header();

while ( have_posts() ) :
	the_post();
	?>
	<div class="roomheader">
		<div class="halign">
			<div class="topsld">
				<?php eco_the_slider( 'nomera_topslider' ); ?>

				<div class="txt">
					<p class="pre">Коттедж с баней</p>
					<h1><?php echo eco_title_html( eco_long_title() ); ?></h1>

					<div class="tbl">
						<div class="lf">
							<p class="price">от <?php echo esc_html( eco_field( 'nomera_price' ) ); ?> Р.</p>
							<p class="small">Будние дни (вс-чт)</p>
							<p class="price mt10"><?php echo esc_html( eco_field( 'nomera_price2' ) ); ?> Р.</p>
							<p class="small">Выходные дни (пт-сб)</p>
						</div>
						<div class="rg">
							<p class="sq"><?php echo esc_html( eco_field( 'nomera_sq' ) ); ?> м2</p>
						</div>
					</div>

					<?php echo do_shortcode( wp_kses_post( eco_field( 'nomera_bronlink' ) ) ); ?>

					<?php if ( eco_field( 'nomera_text' ) ) : ?>
						<?php echo wp_kses_post( wpautop( eco_field( 'nomera_text' ) ) ); ?>
					<?php endif; ?>
					<?php if ( has_excerpt() ) : ?>
						<p><?php echo esc_html( get_the_excerpt() ); ?></p>
					<?php endif; ?>
					<br>

					<?php
					/* В MODX этот блок скрывался условием [[!If]] по id ресурса 56
					   («Баня впечатлений» — это не коттедж, завтрака и животных там нет).
					   Здесь это отдельный флажок, чтобы правка не требовала кода. */
					if ( ! eco_flag( 'nomera_no_extras' ) ) :
						?>
						<p class="icontxt">Можно с животными: 2000 р.</p>
						<p class="icontxt2"><b>Фермерский завтрак:</b> 700 р.
							<a style="color:#669933;" href="<?php echo esc_url( home_url( '/content/rooms/zavtrak.pdf' ) ); ?>" target="_blank" rel="noopener">Подробнее</a>
						</p>
					<?php endif; ?>
				</div>
			</div>
		</div>
	</div>

	<?php the_content(); ?>

	<?php get_template_part( 'template-parts/section-services' ); ?>
	<?php get_template_part( 'template-parts/section-other-rooms' ); ?>
	<?php get_template_part( 'template-parts/section-links' ); ?>
	<?php
endwhile;

get_footer();
