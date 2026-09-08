;(function( $, window, document, undefined ){
	var spgropts = {
		colors:[],
		childs:false
	};
	var actions = {
		init: function(params){
			return this.each(function(){
				opts = $.extend({}, spgropts, params);
				var t=this,th=$(t);
				th.data('p',opts)

				$(window).scroll(function(){
					var h=$(window).height(),w1=window.pageYOffset,w2=window.pageYOffset+h;
					opts = th.data('p');
					if (opts.childs!=false) opts.childs.el = th.find(opts.childs.el);
					if ((th.length>0)&&(opts.colors.length>0)) {
						var p1=th.offset().top,p2=p1+th.height(),oh=th.height()+h;
						if ((w2>p1)) {
							if (w1<p2) {
								var crdval = w2 - p1;
								var pesr = crdval / (oh / 100);
								var res = [];
								var step = 100/(opts.colors.length-1);
								var crs = 0;
								for (var k=0;k<=opts.colors.length-1;k++) {
									if (pesr>(step*k)) crs=k;
								}
								pesr = (pesr - (crs*step)) * (opts.colors.length-1);
								res[0] = Math.round( opts.colors[crs][0] + ((opts.colors[crs+1][0]-opts.colors[crs][0])*pesr/100) );
								res[1] = Math.round( opts.colors[crs][1] + ((opts.colors[crs+1][1]-opts.colors[crs][1])*pesr/100) );
								res[2] = Math.round( opts.colors[crs][2] + ((opts.colors[crs+1][2]-opts.colors[crs][2])*pesr/100) );
								th.css('background','rgb('+res[0]+','+res[1]+','+res[2]+')');
								if (opts.childs!=false) {
									if (opts.childs.el.length>0) {
										var els = opts.childs.el;
										if (opts.childs.disani==true) els.css('transition','all 0s linear 0s');
										els.css(opts.childs.css,'rgb('+res[0]+','+res[1]+','+res[2]+')');
										if (opts.childs.disani==true) {
											setTimeout(function(){
												els.css('transition','');
											},50);
										}
									}
								}
							} else {} //оно выше
						} else {} //оно ниже
					}
				});
			});
		}
	};
	$.fn.spgradient = function(action){
		if (typeof actions === 'object' || !actions) {
			return actions.init.apply(this, arguments);
		}
	};
})( jQuery, window , document );
