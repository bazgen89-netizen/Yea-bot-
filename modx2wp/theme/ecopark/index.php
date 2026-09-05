<?php
/**
 * Запасной шаблон. Отдельных списков на сайте нет — разделы
 * («Услуги», «Публикации», «Коттеджи») это обычные страницы
 * со своим содержимым, поэтому сюда попадают только поиск и архивы.
 */
get_header();
?>
<div class="restaurant">
	<div class="halign">
		<div class="top nobg">
			<h1><?php echo esc_html( wp_get_document_title() ); ?></h1>
		</div>
	</div>
</div>
<div class="content">
	<div class="halign">
		<?php if ( have_posts() ) : ?>
			<?php while ( have_posts() ) : the_post(); ?>
				<article>
					<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
					<?php the_excerpt(); ?>
				</article>
			<?php endwhile; ?>
			<?php the_posts_pagination(); ?>
		<?php else : ?>
			<p>Ничего не найдено.</p>
		<?php endif; ?>
	</div>
</div>
<?php
get_footer();
