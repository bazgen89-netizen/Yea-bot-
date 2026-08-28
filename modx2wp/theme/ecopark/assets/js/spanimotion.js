/*
	SP AniMove Plugin
*/
(function($, window, document, undefined){
	var spmtscr=0
	,func = function(){
		$('.move').each(function(){
			var t=$(this),wih=$(window).height(),w2=spmtscr+wih,p1=t.offset().top,p2=t.offset().top+t.height(),cf=t.attr('cf'),dr=t.attr('dr'),crd=0,wid=$(window).width(),ofs=0,enani=true;//,curt='',st=0;
		  ofs=t.attr('ofm');
		  if (wid>=768) {
			ofs=t.attr('oft');
		  }
		  if (wid>=1200) {
			ofs=t.attr('ofd');
		  }
		  ofs = Number(ofs);
		  if (isNaN(ofs)) ofs=0;
		  if (isNaN(cf)) cf=0;
		  crd = ( (wih+t.height()) - (p2-spmtscr) )*cf, max=(wih+t.height())*cf;
		  if (crd<0) crd=0;
		  if (crd>max) crd=max;
          crd=crd+ofs;
          max=max+ofs;
			if (t.hasClass('an')) enani=false;
			if (t.hasClass('nomovedp') && (wid>1199)) enani=false;
			if (t.hasClass('nomovetp') && (wid>=768) && (wid<1200) ) enani = false;
			if (t.hasClass('nomovemp') && (wid<768)) enani = false;
		  if (enani) {
			  if ((p2>spmtscr)&&(w2>p1)) {
				  if (dr=='v+') t.css('transform','translateY('+crd+'px)');
				  if (dr=='v-') t.css('transform','translateY(-'+crd+'px)');
				  if (dr=='h+') t.css('transform','translateX('+crd+'px)');
				  if (dr=='h-') t.css('transform','translateX(-'+crd+'px)');
			  } else {
				  if (w2<=p1) {
					  t.css('transform','');
				  }
				  if (spmtscr>=p2) {
					  if (dr=='v+') t.css('transform','translateY('+max+'px)');
					  if (dr=='v-') t.css('transform','translateY(-'+max+'px)');
					  if (dr=='h+') t.css('transform','translateX('+max+'px)');
					  if (dr=='h-') t.css('transform','translateX(-'+max+'px)');
				  }
			  }
		  } else t.css('transform','');
		});
	}
	,actions = {
		init: function(params){
			//return this.each(function(){
				$(window).scroll(function(){
					func();
					spmtscr=window.pageYOffset;
				});
				setTimeout(func(),1000);
			//});
		}
	};
	$.fn.spanimotion = function(action){
		if (typeof actions === 'object' || !actions) {
			return actions.init.apply(this, arguments);
		}
	};
})(jQuery, window, document);
