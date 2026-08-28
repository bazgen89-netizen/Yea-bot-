<?php
/**
 * 404. На старом сайте это был обычный ресурс /404.html —
 * если такая страница заведена в WordPress, показываем её содержимое.
 */
get_header();

$eco_404 = get_page_by_path( '404' );
?>
<div class="restaurant">
	<div class="halign">
		<div class="top nobg">
			<h1><?php echo $eco_404 ? esc_html( eco_long_title( $eco_404->ID ) ) : 'Страница не найдена'; ?></h1>
		</div>
	</div>
</div>
<?php if ( $eco_404 ) : ?>
	<?php echo wp_kses_post( apply_filters( 'the_content', $eco_404->post_content ) ); ?>
<?php else : ?>
	<div class="content">
		<div class="halign">
			<p>Такой страницы нет. Возможно, она переехала — попробуйте начать <a href="<?php echo esc_url( home_url( '/' ) ); ?>">с главной</a>.</p>
		</div>
	</div>
<?php endif; ?>
<?php
get_footer();
