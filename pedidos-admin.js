/* Pedidos online (admin): compartido por index.html (app Bodega) y pedidos-admin.html (app Pedidos).
   Usa del entorno: sb, fmtGs, toast, openModal, closeModal, bgConfirm, escapeHtml y goTo. */
(function(){
  var URL_PUBLICA=location.origin+location.pathname.replace(/[^/]*$/,'')+'pedidos.html';
  var EST={pendiente:'Pendiente',aceptado:'Aceptado',preparando:'Preparando',en_camino:'En camino',entregado:'Entregado',cancelado:'Cancelado'};
  var PAGO_LBL={efectivo:'Efectivo',transferencia:'Transferencia',qr:'QR',tarjeta:'Tarjeta (POS)'};
  var tab='pedidos', filtro='activos', bodQ='', vistos=null, pollT=null, repDesde=new Date().toISOString();
  function h(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v??'');}
  function g(id){return document.getElementById(id);}
  function hoyISO(){var d=new Date();d.setHours(0,0,0,0);return d.toISOString();}
  function hora(t){return new Date(t).toLocaleTimeString('es-PY',{hour:'2-digit',minute:'2-digit'});}
  function waNum(t){t=String(t||'').replace(/\D/g,'');if(t.startsWith('0'))t='595'+t.slice(1);return t;}
  function enPedidos(){return g('ped-root')!=null;}

  window.renderPedidosOnline=async function(){
    var c=g('content'); if(!c) return;
    c.innerHTML='<div id="ped-root"><div class="ped-tabs">'+
      ['pedidos:📦 Pedidos','catalogo:🧾 Catálogo online','promos:🏷️ Promociones','visitas:📊 Visitas','config:⚙️ Configuración'].map(function(x){var k=x.split(':');return '<button class="btn btn-secondary btn-sm'+(tab===k[0]?' on':'')+'" onclick="pedTab(\''+k[0]+'\')">'+k[1]+'</button>';}).join('')+
      (typeof addToVenta==='function'?'<a class="btn btn-secondary btn-sm" href="pedidos-admin.html" target="_blank" rel="noopener">📲 App Pedidos</a>':'')+
      '</div><div id="ped-body"><div class="spinner"></div></div></div>';
    if(tab==='pedidos') await pedRenderLista();
    else if(tab==='catalogo') await pedRenderCatalogo();
    else if(tab==='promos') await pedRenderPromos();
    else if(tab==='visitas') await pedRenderVisitas();
    else await pedRenderConfig();
  };
  window.pedTab=function(t){tab=t;renderPedidosOnline();};

  // ─── VISITAS DE LA PÁGINA ───
  var visDias=7;
  window.pedVisDias=function(d){visDias=d;pedRenderVisitas();};
  var SRC_LBL={ig:'📸 Instagram',wa:'💬 WhatsApp',estado:'🟢 Estados',fb:'📘 Facebook',tiktok:'🎵 TikTok',google:'🔎 Google',web:'🌐 Otra web',directo:'🔗 Directo / sin link',otro:'❔ Otro'};
  async function pedRenderVisitas(){
    var b=g('ped-body'); if(!b) return;
    var f=function(d){var x=new Date();x.setDate(x.getDate()-d);return x.toLocaleDateString('en-CA',{timeZone:'America/Asuncion'});};
    var hasta=f(0), desde=f(visDias-1);
    var r=await sb.rpc('pedidos_visitas_resumen',{p_desde:desde,p_hasta:hasta});
    if(r.error){b.innerHTML='<div class="alert alert-error">Error: '+h(r.error.message)+'</div>';return;}
    var d=r.data||{}, pct=function(a,t){return t?Math.round(a/t*100)+'%':'—';};
    var kpi=function(t,v,s){return '<div class="ped-card" style="gap:2px"><div class="ped-meta">'+t+'</div><b style="font-size:22px">'+v+'</b><div class="ped-meta">'+(s||'&nbsp;')+'</div></div>';};
    var dias=d.por_dia||[], mx=Math.max.apply(null,dias.map(function(x){return x.visitas;}).concat([1]));
    var horas=new Array(24).fill(0);(d.por_hora||[]).forEach(function(x){horas[x.h]=x.visitas;});var mh=Math.max.apply(null,horas.concat([1]));
    var base=URL_PUBLICA;
    b.innerHTML='<div class="ped-tabs">'+[[1,'Hoy'],[7,'7 días'],[30,'30 días']].map(function(x){return '<button class="btn btn-secondary btn-sm'+(visDias===x[0]?' on':'')+'" onclick="pedVisDias('+x[0]+')">'+x[1]+'</button>';}).join('')+'</div>'+
      '<div class="ped-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">'+
        kpi('Visitas',d.visitas||0,(d.personas||0)+' personas distintas')+
        kpi('Personas nuevas',d.nuevos||0,'primera vez que entran')+
        kpi('Agregaron al carrito',d.carrito||0,pct(d.carrito||0,d.personas||0)+' de las personas')+
        kpi('Hicieron pedido',d.pedido||0,pct(d.pedido||0,d.personas||0)+' de las personas')+
      '</div>'+
      '<div class="ped-card" style="margin-top:12px"><b>Por día</b>'+(dias.length?'<table><tr><th>Día</th><th>Visitas</th><th>Personas</th><th>Pedidos</th><th style="width:40%"></th></tr>'+dias.slice().reverse().map(function(x){
          return '<tr><td>'+h(new Date(x.d+'T12:00:00').toLocaleDateString('es-PY',{weekday:'short',day:'2-digit',month:'2-digit'}))+'</td><td>'+x.visitas+'</td><td>'+x.personas+'</td><td>'+x.pedidos+'</td><td><div style="height:8px;border-radius:4px;background:var(--accent);width:'+Math.round(x.visitas/mx*100)+'%"></div></td></tr>';}).join('')+'</table>':'<div class="ped-meta">Todavía no hay visitas registradas.</div>')+'</div>'+
      '<div class="ped-card" style="margin-top:12px"><b>De dónde vienen</b>'+((d.por_src||[]).length?'<table><tr><th>Origen</th><th>Visitas</th><th>Pedidos</th></tr>'+(d.por_src||[]).map(function(x){return '<tr><td>'+h(SRC_LBL[x.src]||x.src)+'</td><td>'+x.visitas+'</td><td>'+x.pedidos+'</td></tr>';}).join('')+'</table>':'<div class="ped-meta">Sin datos.</div>')+
        '<div class="ped-meta" style="margin-top:8px">Usá un link distinto en cada lugar para saber de dónde vienen:</div>'+
        [['ig','Instagram'],['wa','WhatsApp'],['estado','Estados de WhatsApp']].map(function(x){var u=base+'?src='+x[0];return '<div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap"><span class="ped-meta" style="min-width:130px">'+x[1]+'</span><code style="font-size:12px;word-break:break-all">'+h(u)+'</code><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard&&navigator.clipboard.writeText(\''+u+'\').then(function(){toast(\'Link copiado\')})">Copiar</button></div>';}).join('')+'</div>'+
      '<div class="ped-card" style="margin-top:12px"><b>Horarios con más visitas</b><div style="display:flex;align-items:flex-end;gap:2px;height:90px;margin-top:8px">'+horas.map(function(x,i){return '<div title="'+i+' h · '+x+' visitas" style="flex:1;min-height:2px;border-radius:3px 3px 0 0;background:var(--accent);opacity:'+(x?1:.25)+';height:'+Math.max(2,Math.round(x/mh*100))+'%"></div>';}).join('')+'</div><div class="ped-meta" style="display:flex;justify-content:space-between"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span></div>'+
        '<div class="ped-meta" style="margin-top:8px">'+pct(d.movil||0,d.visitas||0)+' de las visitas desde el celular.</div></div>';
  }

  // ─── LISTA DE PEDIDOS ───
  window.pedFiltro=function(f){filtro=f;pedRenderLista();};
  async function pedRenderLista(){
    var b=g('ped-body'); if(!b) return;
    var q=sb.from('pedidos_online').select('*').order('created_at',{ascending:false}).limit(150);
    if(filtro==='activos') q=q.in('estado',['pendiente','aceptado','preparando','en_camino']);
    else if(filtro==='hoy') q=q.gte('created_at',hoyISO());
    else if(filtro==='cancelados') q=q.eq('estado','cancelado');
    var r=await q, rh=await sb.from('pedidos_online').select('total_asadito,total_bodega,costo_delivery,estado,repartidor,metodo_pago,total').gte('created_at',hoyISO());
    if(r.error){b.innerHTML='<div class="alert alert-error">Error: '+h(r.error.message)+'</div>';return;}
    var ent=(rh.data||[]).filter(function(p){return p.estado==='entregado';});
    var sum=function(k){return ent.reduce(function(a,p){return a+Number(p[k]||0);},0);};
    var html='<div class="ped-sum"><div><span class="ped-meta">Entregados hoy</span><b>'+ent.length+'</b></div>'+
      '<div><span class="ped-meta">🔥 Asadito (su caja)</span><b>'+fmtGs(sum('total_asadito'))+'</b></div>'+
      '<div><span class="ped-meta">🛒 Bodega</span><b>'+fmtGs(sum('total_bodega'))+'</b></div>'+
      '<div><span class="ped-meta">🛵 Delivery cobrado</span><b>'+fmtGs(sum('costo_delivery'))+'</b></div></div>'+
      (function(){var R={};ent.forEach(function(p){if(!p.repartidor)return;var x=R[p.repartidor]=R[p.repartidor]||{n:0,ef:0};x.n++;if(p.metodo_pago==='efectivo')x.ef+=Number(p.total)||0;});
        var ks=Object.keys(R);return ks.length?'<div class="ped-acts" style="margin:6px 0 10px">'+ks.map(function(k){return '<span class="ped-meta" style="background:var(--accent-bg);border-radius:8px;padding:6px 10px">🛵 <b>'+h(k)+'</b>: '+R[k].n+' entrega'+(R[k].n>1?'s':'')+' · efectivo '+fmtGs(R[k].ef)+'</span>';}).join('')+'</div>':'';})()+
      '<div class="ped-tabs">'+[['activos','Activos'],['hoy','Hoy'],['cancelados','Cancelados'],['todos','Últimos 150']].map(function(f){return '<button class="btn btn-secondary btn-sm'+(filtro===f[0]?' on':'')+'" onclick="pedFiltro(\''+f[0]+'\')">'+f[1]+'</button>';}).join('')+
      '<button class="btn btn-secondary btn-sm" onclick="pedRenderLista()">↻ Actualizar</button></div>';
    var ps=r.data||[];
    html+=ps.length?'<div class="ped-grid">'+ps.map(cardHtml).join('')+'</div>':'<div class="alert">No hay pedidos '+(filtro==='activos'?'activos':'')+'.</div>';
    b.innerHTML=html;
  }
  window.pedRenderLista=pedRenderLista;

  function cardHtml(p){
    var its=p.items||[], asd=its.filter(function(i){return i.origen==='asadito';}), bod=its.filter(function(i){return i.origen==='bodega';});
    var li=function(i){return '<div class="ped-it"><span>'+i.cantidad+'× '+h(i.nombre)+(i.combo?' <span class="ped-meta">· 🎁 '+h(i.combo)+'</span>':'')+(i.desc_pct?' <span class="ped-meta">· −'+i.desc_pct+'%</span>':'')+(i.envase==='tengo'?' <b style="color:var(--green)">· ♻️ trae '+i.envases+' envase'+(i.envases>1?'s':'')+'</b>':'')+'</span><span>'+fmtGs(i.subtotal)+'</span></div>';};
    var vuelto=p.metodo_pago==='efectivo'&&Number(p.paga_con)>Number(p.total)?' · paga con '+fmtGs(p.paga_con)+' → vuelto '+fmtGs(p.paga_con-p.total):'';
    var acts='';
    var btn=function(lbl,fn,cls){return '<button class="btn '+(cls||'btn-secondary')+' btn-sm" onclick="'+fn+'">'+lbl+'</button>';};
    if(p.estado==='pendiente') acts+=btn('✅ Aceptar',"pedAceptar('"+p.id+"')",'btn-primary');
    if(p.estado==='aceptado') acts+=btn('🔥 Preparando',"pedEstado('"+p.id+"','preparando')",'btn-primary');
    if((p.estado==='aceptado'||p.estado==='preparando')&&p.entrega==='delivery') acts+=btn('🛵 En camino',"pedEstado('"+p.id+"','en_camino')",'btn-primary');
    if(['aceptado','preparando','en_camino'].indexOf(p.estado)>=0) acts+=btn('🎉 Entregado',"pedEstado('"+p.id+"','entregado')",'btn-primary');
    // Al entregar, la venta de bodega (+ delivery) se registra sola; el cobro manual queda solo como respaldo
    if(p.venta_bodega_num){}
    else if(p.estado==='entregado'&&!p.bodega_cargado&&(bod.length||Number(p.costo_delivery)>0)) acts+=btn('↻ Registrar venta bodega',"pedVentaBodega('"+p.id+"')",'btn-primary');
    else if(bod.length&&p.estado!=='cancelado'&&p.estado!=='entregado') acts+=btn(p.bodega_cargado?'🛒 Venta bodega ✓ (recargar)':'🛒 Cobrar bodega en caja',"pedCargarBodega('"+p.id+"')",'btn-secondary');
    if(p.entrega==='delivery'&&['pendiente','aceptado','preparando','en_camino'].indexOf(p.estado)>=0) acts+=btn(p.repartidor?'🛵 Reenviar a '+h(p.repartidor):'🛵 Enviar al delivery',"pedRepartidor('"+p.id+"')",p.repartidor?'btn-secondary':'btn-primary');
    acts+=btn('💬 WhatsApp',"pedWa('"+p.id+"')");
    if(['pendiente','aceptado','preparando'].indexOf(p.estado)>=0) acts+=btn('Cancelar',"pedEstado('"+p.id+"','cancelado')");
    if(p.estado==='cancelado') acts+=btn('🗑 Eliminar',"pedEliminar('"+p.id+"')");
    return '<div class="ped-card '+p.estado+'" data-id="'+p.id+'">'+
      '<div class="ped-head"><span class="ped-num">#'+p.numero+'</span><span class="ped-meta">'+hora(p.created_at)+(filtro!=='activos'?' · '+new Date(p.created_at).toLocaleDateString('es-PY'):'')+'</span><span class="ped-est '+p.estado+'">'+EST[p.estado]+'</span></div>'+
      '<div><b>'+h(p.cliente_nombre)+'</b> · <a href="tel:'+h(p.cliente_telefono)+'">'+h(p.cliente_telefono)+'</a></div>'+
      '<div class="ped-meta">'+(p.entrega==='delivery'?'🛵 '+h(p.direccion||'')+(p.ubicacion?' · <a target="_blank" rel="noopener" href="'+h(p.ubicacion)+'">📍 mapa</a>':'')+(p.delivery_km!=null?' · '+String(Math.round(p.delivery_km*10)/10).replace('.',',')+' km':''):'🏪 Retira en local')+'</div>'+
      '<div class="ped-meta">💳 '+h(PAGO_LBL[p.metodo_pago]||p.metodo_pago)+vuelto+'</div>'+
      (p.repartidor?'<div class="ped-meta">🛵 <b>'+h(p.repartidor)+'</b>'+(p.salio_at?' · salió '+hora(p.salio_at):' · todavía no salió')+(p.entregado_at?' · entregado '+hora(p.entregado_at):'')+'</div>':'')+
      (p.eta_at&&['aceptado','preparando','en_camino'].indexOf(p.estado)>=0?'<div class="ped-meta">🕐 '+(p.entrega==='delivery'?'Llega':'Listo')+' aprox. '+hora(p.eta_at)+'</div>':'')+
      (p.venta_bodega_num?'<div class="ped-meta" style="color:var(--green);font-weight:700">🛒 Venta bodega #'+p.venta_bodega_num+' ✓ registrada al entregar</div>':'')+
      (p.venta_bodega_aviso?'<div class="ped-meta" style="color:var(--amber,#b7791f);font-weight:600">⚠️ '+h(p.venta_bodega_aviso)+'</div>':'')+
      (p.estado==='entregado'&&Number(p.total_asadito)>0?'<div style="background:var(--accent-bg);border-radius:8px;padding:6px 8px;font-size:13px">🔥 Asadito: <b>'+fmtGs(p.total_asadito)+'</b> → pasar a la caja del asadito</div>':'')+
      (p.calificacion?'<div style="font-size:13px"><span style="color:#f5a623">'+'★'.repeat(p.calificacion)+'</span><span style="color:var(--border)">'+'★'.repeat(5-p.calificacion)+'</span>'+(p.calificacion_txt?' · '+h(p.calificacion_txt):'')+'</div>':'')+
      (p.alerta?'<div style="background:#fff4e5;border:1px solid #f5c26b;border-radius:8px;padding:6px 8px;font-size:13px">⚠️ '+h(p.alerta)+(p.promo==='delivery_gratis_primera'?' · se le aplicó delivery gratis de 1ª compra':'')+'</div>':'')+
      (p.mayor_18?'<div class="ped-meta" style="color:var(--red);font-weight:700">🔞 +18: verificar cédula al entregar</div>':'')+
      (p.factura_ruc?'<div style="background:var(--accent-bg);border-radius:8px;padding:6px 8px;font-size:13px"><b>🧾 FACTURA</b> · RUC <b>'+h(p.factura_ruc)+'</b> · '+h(p.factura_razon||'')+'</div>':'')+
      (p.notas?'<div class="ped-meta">📝 '+h(p.notas)+'</div>':'')+
      (asd.length?'<div class="ped-sec">🔥 Asadito · '+fmtGs(p.total_asadito)+'</div>'+asd.map(li).join(''):'')+
      (bod.length?'<div class="ped-sec">🛒 Bodega · '+fmtGs(p.total_bodega)+'</div>'+bod.map(li).join(''):'')+
      (function(){var ag={};(p.promos||[]).forEach(function(x){if(x.tipo==='primera_compra')return;var k=x.tipo+'|'+x.nombre;ag[k]=(ag[k]||0)+Number(x.monto||0);});
        return Object.keys(ag).map(function(k){var t=k.split('|');var del=t[0]==='delivery_gratis'||t[0]==='fidelidad';
          return '<div class="ped-it" style="color:var(--green);font-weight:700"><span>'+(del?'🎉 Delivery gratis · ':t[0]==='combo'?'🎁 ':'🏷️ ')+h(t[1])+'</span><span>'+(del?'Gs. 0':'−'+fmtGs(ag[k]))+'</span></div>';}).join('');})()+
      (p.promo==='delivery_gratis_primera'?'<div class="ped-it" style="color:var(--green);font-weight:700"><span>🎉 Delivery gratis (1ª compra)</span><span>Gs. 0</span></div>':'')+
      (Number(p.costo_delivery)?'<div class="ped-it"><span>Delivery</span><span>'+fmtGs(p.costo_delivery)+'</span></div>':'')+
      '<div class="ped-tot"><span>Total</span><span>'+fmtGs(p.total)+'</span></div>'+
      '<div class="ped-acts">'+acts+'</div></div>';
  }

  async function getPed(id){var r=await sb.from('pedidos_online').select('*').eq('id',id).single();if(r.error){toast('Error: '+r.error.message,'err');return null;}return r.data;}
  window.pedEstado=async function(id,est){
    if(est==='cancelado'&&!(await bgConfirm('¿Cancelar este pedido?',{title:'Cancelar pedido',confirmText:'Cancelar pedido',variant:'warning'})))return;
    var r=await sb.from('pedidos_online').update({estado:est,updated_at:new Date().toISOString()}).eq('id',id);
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast('Pedido: '+EST[est]);
    if(est==='entregado'){var pe=await getPed(id);if(pe&&pe.venta_bodega_num)toast('🛒 Venta bodega #'+pe.venta_bodega_num+' registrada: '+fmtGs(Number(pe.total_bodega)+Number(pe.costo_delivery||0)));else if(pe&&pe.venta_bodega_aviso)toast('⚠️ '+pe.venta_bodega_aviso,'err');}
    if(est==='aceptado'||est==='en_camino'){var p=await getPed(id);if(p)pedWaMsg(p,est);}
    pedRenderLista(); pedPoll();
  };
  // Aceptar eligiendo en cuánto llega / está listo: el cliente ve la hora en su pantalla
  window.pedAceptar=function(id){
    openModal('✅ Aceptar pedido','<p class="ped-meta" style="margin-bottom:10px">¿En cuánto tiempo llega (o está listo para retirar)? El cliente ve la hora estimada.</p><div class="ped-acts">'+
      [15,20,30,45,60,90].map(function(m){return '<button class="btn btn-primary" onclick="pedAceptarCon(\''+id+'\','+m+')">'+m+' min</button>';}).join('')+
      '<button class="btn btn-secondary" onclick="pedAceptarCon(\''+id+'\',0)">Sin hora</button></div>',null,'');
  };
  window.pedAceptarCon=async function(id,min){
    closeModal();
    var o={estado:'aceptado',updated_at:new Date().toISOString()};if(min)o.eta_at=new Date(Date.now()+min*60000).toISOString();
    var r=await sb.from('pedidos_online').update(o).eq('id',id);
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast('Pedido aceptado');var p=await getPed(id);if(p)pedWaMsg(p,'aceptado');
    pedRenderLista(); pedPoll();
  };
  window.pedVentaBodega=async function(id){
    var r=await sb.rpc('pedidos_venta_bodega',{p_id:id});
    if(r.error||!r.data||!r.data.ok){toast('Error: '+((r.error&&r.error.message)||(r.data&&r.data.error)||'no se pudo registrar'),'err');return;}
    toast(r.data.numero_venta?'Venta bodega #'+r.data.numero_venta+' registrada':'No había nada para registrar');pedRenderLista();
  };
  window.pedEliminar=async function(id){
    if(!(await bgConfirm('¿Eliminar este pedido cancelado? No se puede deshacer.',{title:'Eliminar pedido',confirmText:'Eliminar',variant:'warning'})))return;
    var r=await sb.from('pedidos_online').delete().eq('id',id).eq('estado','cancelado');
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast('Pedido eliminado'); pedRenderLista();
  };
  function pedWaMsg(p,est){
    var eta=p.eta_at?new Date(p.eta_at).toLocaleTimeString('es-PY',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'';
    var m={aceptado:'¡Hola '+p.cliente_nombre+'! Recibimos tu pedido #'+p.numero+' ✅ Total: '+fmtGs(p.total)+'. '+(p.entrega==='delivery'?(eta?'Llega aprox. a las '+eta+'. ':'')+'Te avisamos cuando salga.':(eta?'Va a estar listo aprox. a las '+eta+'. ':'')+'Te avisamos cuando esté listo para retirar.'),
      en_camino:'Hola '+p.cliente_nombre+', tu pedido #'+p.numero+' ya está en camino 🛵'}[est];
    if(!m) m='Hola '+p.cliente_nombre+', sobre tu pedido #'+p.numero+': ';
    window.open('https://wa.me/'+waNum(p.cliente_telefono)+'?text='+encodeURIComponent(m),'_blank');
  }
  // Repartidor: link solo para este pedido (entrega.html?t=...) + datos por WhatsApp
  var URL_ENTREGA=URL_PUBLICA.replace(/pedidos\.html$/,'entrega.html');
  function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(ch){var v=Math.random()*16|0;return (ch==='x'?v:(v&3|8)).toString(16);});}
  window.pedRepartidor=async function(id){
    var r=await sb.from('pedidos_config').select('repartidores').eq('id',1).maybeSingle();
    var rs=(r.data&&r.data.repartidores)||[];
    openModal('🛵 Enviar al delivery','<p class="ped-meta" style="margin-bottom:10px">Le llega por WhatsApp un link con los datos del cliente, el mapa y los botones «Salí» y «Entregado».</p>'+
      '<div class="ped-acts" style="flex-direction:column;align-items:stretch">'+rs.map(function(x,i){return '<button class="btn btn-primary" onclick="pedRepEnviar(\''+id+'\','+i+')">🛵 '+h(x.nombre)+' · '+h(x.tel)+'</button>';}).join('')+
      '<button class="btn btn-secondary" onclick="pedRepEnviar(\''+id+'\',-1)">📱 Elegir otro contacto en WhatsApp</button></div>'+
      (rs.length?'':'<p class="ped-meta" style="margin-top:10px">Tip: cargá tus repartidores en Configuración para enviarles con un toque.</p>'),null,'');
  };
  window.pedRepEnviar=async function(id,i){
    var p=await getPed(id);if(!p)return;
    var c=await sb.from('pedidos_config').select('repartidores').eq('id',1).maybeSingle();
    var reps=(c.data&&c.data.repartidores)||[],rep=i>=0?reps[i]:null;
    if(rep&&!rep.token){rep.token=uuid();await sb.from('pedidos_config').update({repartidores:reps}).eq('id',1);}
    var tk=p.driver_token||uuid();
    var u=await sb.from('pedidos_online').update({driver_token:tk,repartidor:rep?rep.nombre:(p.repartidor||'Delivery'),repartidor_tk:rep?rep.token:null,updated_at:new Date().toISOString()}).eq('id',id);
    if(u.error){toast('Error: '+u.error.message,'err');return;}
    var its=(p.items||[]).filter(function(x){return !x.es_envase;}).map(function(x){return x.cantidad+'× '+x.nombre;}).join(' · ');
    var cob=p.metodo_pago==='transferencia'?'Transferencia (confirmar con el local)':'Cobrar '+fmtGs(p.total)+' ('+(PAGO_LBL[p.metodo_pago]||p.metodo_pago)+')'+(p.metodo_pago==='efectivo'&&Number(p.paga_con)>Number(p.total)?' · paga con '+fmtGs(p.paga_con)+' → vuelto '+fmtGs(p.paga_con-p.total):'');
    var m='🛵 *Pedido #'+p.numero+'* — '+p.cliente_nombre+'\n📞 '+p.cliente_telefono+'\n📍 '+(p.direccion||'')+(p.ubicacion?'\n🗺️ '+p.ubicacion:'')+'\n📦 '+its+'\n💵 '+cob+(p.notas?'\n📝 '+p.notas:'')+(p.factura_ruc?'\n🧾 Lleva factura':'')+
      '\n\n👉 Abrí acá para ver todo y marcar Salí / Entregado:\n'+URL_ENTREGA+'?t='+tk;
    closeModal();
    window.open('https://wa.me/'+(rep?waNum(rep.tel):'')+'?text='+encodeURIComponent(m),'_blank');
    toast('Enviado a '+(rep?rep.nombre:'WhatsApp'));pedRenderLista();
  };
  window.pedWa=async function(id){var p=await getPed(id);if(p)pedWaMsg(p,p.estado);};

  // Carga los productos de bodega del pedido en "Nueva venta" (descuenta stock y entra a la caja de la bodega al finalizar)
  window.pedCargarBodega=async function(id){
    if(typeof addToVenta!=='function'){location.href='index.html?cargar='+encodeURIComponent(id);return;}
    var p=await getPed(id); if(!p) return;
    var bod=(p.items||[]).filter(function(i){return i.origen==='bodega';});
    if(!bod.length) return;
    if(p.bodega_cargado&&!(await bgConfirm('La parte de bodega de este pedido ya se cargó a una venta. ¿Cargarla de nuevo?',{title:'Pedido #'+p.numero,confirmText:'Cargar de nuevo',variant:'warning'})))return;
    if(cart&&cart.length&&!(await bgConfirm('Hay productos en la venta actual. ¿Reemplazarlos por el pedido #'+p.numero+'?',{title:'Venta en curso',confirmText:'Reemplazar',variant:'warning'})))return;
    if(typeof loadCaches==='function') await loadCaches();
    await goTo('ventas');
    setTimeout(async function(){
      try{ cart=[]; }catch(e){}
      var falta=[];
      bod.forEach(function(i){
        var okP=prodCache.find(function(x){return x.id===i.id;}), okE=!i.pack||(embCache[i.id]||[]).some(function(e){return e.id===i.pack;});
        if(okP&&okE) addToVenta(i.id,i.pack||null,Number(i.cantidad)||1); else falta.push(i.nombre);
      });
      var el=g('v-cliente'); if(el) el.value='Pedido #'+p.numero+' · '+(p.factura_ruc?(p.factura_razon||p.cliente_nombre)+' · RUC '+p.factura_ruc:p.cliente_nombre);
      var dsc=g('v-desc'); if(dsc&&Number(p.descuento_bodega)>0){dsc.value=Math.round(Number(p.descuento_bodega));if(typeof updateVTotals==='function')updateVTotals();}
      if(typeof selectPay==='function') selectPay({transferencia:'transferencia',qr:'qr',tarjeta:'debito'}[p.metodo_pago]||'efectivo');
      if(typeof renderVentaTable==='function') renderVentaTable();
      if(typeof updateVTotals==='function') updateVTotals();
      await sb.from('pedidos_online').update({bodega_cargado:true,updated_at:new Date().toISOString()}).eq('id',p.id);
      toast(falta.length?'Faltan productos: '+falta.join(', '):'Pedido #'+p.numero+' cargado. Revisá y finalizá la venta.',falta.length?'err':'ok');
    },450);
  };

  // ─── CATÁLOGO ONLINE ───
  async function pedRenderCatalogo(){
    var b=g('ped-body'); if(!b) return;
    // productos del sistema de control de asaditos (no se modifican; la configuración online va aparte)
    var ra=await sb.rpc('pedidos_asadito_admin'); if(!ra.error) ra.data=(ra.data||[]).filter(function(p){return p.activo;});
    var CATS_A=['ASADITO','EMBUTIDO','BEBIDA','OTROS'];
    // foto del asadito para la página de pedidos (se guarda en la configuración online)
    var fotoA=function(p){return '<label title="'+(p.imagen_url?'Cambiar foto':'Agregar foto')+'" style="flex:0 0 auto;width:44px;height:44px;margin-left:8px;border-radius:10px;border:1px dashed var(--border2,#ccc);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;background:var(--bg3,#f3f4f6)">'+
      (p.imagen_url?'<img src="'+h(p.imagen_url)+'" alt="" style="width:100%;height:100%;object-fit:cover">':'📷')+
      '<input type="file" accept="image/*" hidden onchange="pedAsaditoFoto(\''+p.id+'\',this,\''+h(p.imagen_url||'')+'\')"></label>'+
'';};
    var fotoX=function(p){return p.imagen_url?'<button type="button" class="btn btn-secondary btn-sm" title="Quitar foto" onclick="pedAsaditoFoto(\''+p.id+'\',null,\''+h(p.imagen_url)+'\')">✕ Foto</button>':'';};
    var catSel=function(p){return '<select style="width:auto;padding:4px;font-size:12px" onclick="event.stopPropagation()" onchange="pedAsaditoCat(\''+p.id+'\',this.value)">'+CATS_A.map(function(c){return '<option'+(p.categoria===c?' selected':'')+'>'+c+'</option>';}).join('')+'</select>';};
    var t=bodQ, qb=sb.from('bodega_productos').select('id,nombre,precio_venta,stock,vender_online,envase_id,destacado_online').eq('activo',true).order('nombre').limit(200);
    qb=t?qb.ilike('nombre','%'+t.replace(/[%_,()]/g,' ')+'%'):qb.eq('vender_online',true);
    var rb=await qb, lista=rb.data||[];
    // productos de envase (categoría ENVASES) para vincular a retornables
    var catEnv=(await sb.from('bodega_categorias').select('id').eq('nombre','ENVASES').maybeSingle()).data;
    var re=catEnv?await sb.from('bodega_productos').select('id,nombre,precio_venta').eq('categoria_id',catEnv.id).eq('activo',true).order('nombre'):{data:[]};
    var envases=re.data||[];
    var envSel=function(p){return envases.length?'<select title="Envase retornable" style="width:auto;max-width:170px;padding:4px;font-size:12px" onclick="event.stopPropagation()" onchange="pedEnvase(\''+p.id+'\',this.value)"><option value="">♻️ No retornable</option>'+envases.map(function(e){return '<option value="'+e.id+'"'+(p.envase_id===e.id?' selected':'')+'>♻️ '+h(e.nombre.replace(/^ENVASE /,''))+' · '+fmtGs(e.precio_venta)+'</option>';}).join('')+'</select>':'';};
    var row=function(origen,p,precio,sub){return '<label class="ped-row"><input type="checkbox" '+(p.vender_online?'checked':'')+' onchange="pedToggle(\''+origen+'\',\''+p.id+'\',this.checked)"><span style="flex:1">'+h(p.nombre)+(sub?' <span class="ped-meta">· '+h(sub)+'</span>':'')+'</span><span class="ped-meta">'+fmtGs(precio)+'</span></label>';};
    b.innerHTML='<div class="alert" style="margin-bottom:12px">Marcá lo que tus clientes pueden pedir en <a href="'+h(URL_PUBLICA)+'" target="_blank" rel="noopener">'+h(URL_PUBLICA)+'</a>. Los precios son los mismos del sistema. Tocá ⭐ para mostrar un producto en «Destacados» (hasta 8).</div>'+
      '<div class="ped-grid">'+
      '<div class="card"><div class="card-header"><h3>🔥 Asadito</h3></div>'+'<div class="ped-meta" style="padding:8px 12px">Productos y precios de tu sistema de control de asaditos.</div>'+(ra.error?'<div class="alert alert-error">'+h(ra.error.message)+'</div>':(ra.data||[]).map(function(p){return '<div class="ped-brow ped-arow">'+fotoA(p)+'<div style="flex:1;min-width:0">'+row('asadito',p,p.precio,'')+'<div class="ped-bctl">'+catSel(p)+fotoX(p)+'</div></div></div>';}).join(''))+'</div>'+
      '<div class="card"><div class="card-header"><h3>🛒 Bodega</h3></div><div style="padding:10px"><input id="ped-bodq" placeholder="Buscar producto para agregar…" value="'+h(bodQ)+'" oninput="pedBodQ(this.value)" style="width:100%"></div>'+
      (lista.length?lista.map(function(p){return '<div class="ped-brow">'+row('bodega',p,p.precio_venta,(Number(p.stock)||0)+' en stock')+'<div class="ped-bctl">'+envSel(p)+(p.vender_online?'<button type="button" class="btn btn-secondary btn-sm" title="Destacar en la página" style="margin:0 8px 0 6px;flex:0 0 auto;'+(p.destacado_online?'color:#f59e0b;border-color:#f59e0b':'opacity:.45')+'" onclick="pedDestacar(\''+p.id+'\','+(!p.destacado_online)+')">⭐</button>':'')+'</div></div>';}).join(''):'<div class="ped-meta" style="padding:12px">'+(t?'Sin resultados':'Todavía no hay productos de bodega online. Buscá arriba para agregar.')+'</div>')+'</div>'+
      '</div>';
    var inp=g('ped-bodq'); if(inp&&bodQ){inp.focus();inp.setSelectionRange(bodQ.length,bodQ.length);}
  }
  var bqT; window.pedBodQ=function(v){clearTimeout(bqT);bqT=setTimeout(function(){bodQ=v.trim();pedRenderCatalogo();},300);};
  window.pedAsaditoCat=async function(id,cat){
    var r=await sb.from('pedidos_asadito_online').upsert({prod_id:id,categoria:cat,updated_at:new Date().toISOString()},{onConflict:'prod_id'});
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast('Categoría: '+cat);
  };
  // Reduce la foto a 400px y la pasa a WebP (igual que en bodega)
  function fotoWebp(file){
    return new Promise(function(res,rej){
      var img=new Image(), u=URL.createObjectURL(file);
      img.onload=function(){var r=Math.min(1,400/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*r);c.height=Math.round(img.height*r);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(function(b){b?res(b):rej(new Error('No se pudo procesar la imagen'));},'image/webp',0.8);};
      img.onerror=function(){URL.revokeObjectURL(u);rej(new Error('Archivo de imagen inválido'));};
      img.src=u;
    });
  }
  window.pedAsaditoFoto=async function(id,inp,anterior){
    try{
      var url=null;
      if(inp){var f=inp.files&&inp.files[0];inp.value='';if(!f)return;
        toast('Subiendo foto…');
        var blob=await fotoWebp(f), path='asadito/'+id+'/'+Date.now()+'.webp';
        var up=await sb.storage.from('productos').upload(path,blob,{contentType:'image/webp',cacheControl:'31536000',upsert:false});
        if(up.error) throw up.error;
        url=sb.storage.from('productos').getPublicUrl(path).data.publicUrl;
      }else if(!(await bgConfirm('¿Quitar la foto de este asadito?'))) return;
      var r=await sb.from('pedidos_asadito_online').upsert({prod_id:id,imagen_url:url,updated_at:new Date().toISOString()},{onConflict:'prod_id'});
      if(r.error) throw r.error;
      var m=String(anterior||'').match(/\/object\/public\/productos\/(.+)$/); if(m) sb.storage.from('productos').remove([decodeURIComponent(m[1].split('?')[0])]).catch(function(){});
      toast(url?'📷 Foto guardada':'Foto quitada'); pedRenderCatalogo();
    }catch(e){toast('No se pudo guardar la foto: '+(e.message||e),'err');}
  };
  window.pedEnvase=async function(id,envId){
    var r=await sb.from('bodega_productos').update({envase_id:envId||null}).eq('id',id);
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast(envId?'Marcado como retornable':'Ya no es retornable');
  };
  window.pedDestacar=async function(id,on){
    var r=await sb.from('bodega_productos').update({destacado_online:on}).eq('id',id);
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast(on?'⭐ Destacado en la página':'Quitado de destacados');pedRenderCatalogo();
  };
  window.pedToggle=async function(origen,id,on){
    var r=origen==='asadito'
      ? await sb.from('pedidos_asadito_online').upsert({prod_id:id,vender_online:on,updated_at:new Date().toISOString()},{onConflict:'prod_id'})
      : await sb.from('bodega_productos').update({vender_online:on}).eq('id',id);
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast(on?'Visible online':'Oculto online');
  };

  // ─── PROMOCIONES ───
  var TIPOS_P={delivery_gratis:'🛵 Delivery gratis desde un monto',descuento:'🏷️ Descuento %',combo:'🎁 Combo a precio cerrado',fidelidad:'⭐ Fidelidad (cada N pedidos)'};
  var DIAS_C=[[1,'Lun'],[2,'Mar'],[3,'Mié'],[4,'Jue'],[5,'Vie'],[6,'Sáb'],[0,'Dom']];
  var promoProds=null;
  async function cargarProdsPromo(){
    if(promoProds) return promoProds;
    var ra=await sb.rpc('pedidos_asadito_admin'), rb=await sb.from('bodega_productos').select('id,nombre,precio_venta,envase_id,categoria_id').eq('activo',true).gt('precio_venta',0).order('nombre').limit(1000);
    var rc=await sb.from('bodega_categorias').select('nombre').order('nombre');
    promoProds={a:(ra.data||[]).filter(function(x){return x.activo&&x.precio>0;}),b:(rb.data||[]).filter(function(x){return !x.envase_id;}),cats:(rc.data||[]).map(function(x){return x.nombre;})};
    return promoProds;
  }
  function horarioPromo(x){
    var d=(x.dias&&x.dias.length&&x.dias.length<7)?DIAS_C.filter(function(z){return x.dias.indexOf(z[0])>=0;}).map(function(z){return z[1];}).join(', '):'Todos los días';
    return d+(x.hora_desde&&x.hora_hasta?' · '+x.hora_desde+'–'+(x.hora_hasta==='24:00'?'00:00':x.hora_hasta):' · todo el día');
  }
  function detallePromo(x){
    if(x.tipo==='delivery_gratis') return 'Desde '+fmtGs(x.monto_minimo||0)+(x.local?' en '+x.local:'');
    if(x.tipo==='descuento') return (x.porcentaje||0)+'% en '+(x.categorias&&x.categorias.length?x.categorias.join(', '):'todo')+(x.local?' ('+x.local+')':'')+(Number(x.monto_minimo)>0?' · compras desde '+fmtGs(x.monto_minimo):'');
    if(x.tipo==='combo') return fmtGs(x.precio||0)+' · '+((x.combo||[]).length)+' producto(s)';
    if(x.tipo==='fidelidad') return 'Cada '+x.cada_n+' pedidos, el siguiente con delivery gratis';
    return '';
  }
  async function pedRenderPromos(){
    var b=g('ped-body'); if(!b) return;
    var r=await sb.from('pedidos_promos').select('*').order('orden').order('created_at');
    if(r.error){b.innerHTML='<div class="alert alert-error">Error: '+h(r.error.message)+'</div>';return;}
    var L=r.data||[];
    b.innerHTML='<div class="ped-tabs"><button class="btn btn-primary btn-sm" onclick="pedPromoEditar()">+ Nueva promoción</button></div>'+
      (L.length?'<div class="ped-grid">'+L.map(function(x){
        return '<div class="ped-card"><div class="ped-head"><b>'+h(x.nombre)+'</b><label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" style="width:auto" '+(x.activa?'checked':'')+' onchange="pedPromoActiva(\''+x.id+'\',this.checked)"> Activa</label></div>'+
          '<div class="ped-meta">'+h(TIPOS_P[x.tipo]||x.tipo)+'</div><div>'+h(detallePromo(x))+'</div>'+(x.imagenes&&x.imagenes.length?'<div style="display:flex;gap:4px">'+x.imagenes.map(function(u){return '<img src="'+h(u)+'" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid var(--border)">';}).join('')+'</div>':'')+'<div class="ped-meta">🕐 '+h(horarioPromo(x))+'</div>'+
          (x.mensaje?'<div class="ped-meta">💬 '+h(x.mensaje)+'</div>':'')+
          '<div class="ped-acts"><button class="btn btn-secondary btn-sm" onclick="pedPromoEditar(\''+x.id+'\')">Editar</button><button class="btn btn-secondary btn-sm" onclick="pedPromoBorrar(\''+x.id+'\')">🗑 Eliminar</button></div></div>';
      }).join('')+'</div>':'<div class="alert">Todavía no hay promociones. Creá la primera con “+ Nueva promoción”.</div>');
  }
  window.pedPromoActiva=async function(id,on){var r=await sb.from('pedidos_promos').update({activa:on,updated_at:new Date().toISOString()}).eq('id',id);if(r.error)toast('Error: '+r.error.message,'err');else toast(on?'Promo activada':'Promo pausada');};
  window.pedPromoBorrar=async function(id){
    if(!(await bgConfirm('¿Eliminar esta promoción?',{title:'Eliminar promoción',confirmText:'Eliminar',variant:'warning'})))return;
    var r=await sb.from('pedidos_promos').delete().eq('id',id);if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast('Promoción eliminada');pedRenderPromos();
  };
  var promoEd=null;
  window.pedPromoEditar=async function(id){
    var P=await cargarProdsPromo();
    promoEd={id:id||null,tipo:'delivery_gratis',nombre:'',activa:true,dias:[],hora_desde:'',hora_hasta:'',local:'',monto_minimo:0,porcentaje:10,categorias:[],combo:[],precio:0,cada_n:5,mensaje:'',orden:0,imagenes:[]};
    if(id){var r=await sb.from('pedidos_promos').select('*').eq('id',id).single();if(r.data)Object.assign(promoEd,r.data,{dias:r.data.dias||[],categorias:r.data.categorias||[],combo:r.data.combo||[],imagenes:r.data.imagenes||[],local:r.data.local||'',hora_desde:r.data.hora_desde||'',hora_hasta:r.data.hora_hasta||'',mensaje:r.data.mensaje||''});}
    openModal(id?'Editar promoción':'Nueva promoción','<div id="promo-form"></div>',pedPromoGuardar,'Guardar');
    pedPromoForm();
  };
  function promoLeer(){
    var f=function(i){var e=g(i);return e?e.value:'';};
    if(g('pp-nombre')) promoEd.nombre=f('pp-nombre').trim();
    if(g('pp-mensaje')) promoEd.mensaje=f('pp-mensaje').trim();
    if(g('pp-desde')) promoEd.hora_desde=f('pp-desde'); if(g('pp-hasta')) promoEd.hora_hasta=f('pp-hasta');
    promoEd.dias=[].slice.call(document.querySelectorAll('.pp-dia:checked')).map(function(x){return Number(x.value);});
    if(g('pp-local')) promoEd.local=f('pp-local');
    if(g('pp-min')) promoEd.monto_minimo=Number(String(f('pp-min')).replace(/\D/g,''))||0;
    if(g('pp-pct')) promoEd.porcentaje=Number(f('pp-pct'))||0;
    if(g('pp-precio')) promoEd.precio=Number(String(f('pp-precio')).replace(/\D/g,''))||0;
    if(g('pp-n')) promoEd.cada_n=Number(f('pp-n'))||0;
    if(document.querySelector('.pp-cat')) promoEd.categorias=[].slice.call(document.querySelectorAll('.pp-cat:checked')).map(function(x){return x.value;});
    if(g('pp-orden')) promoEd.orden=Number(f('pp-orden'))||0;
  }
  window.pedPromoTipo=function(t){promoLeer();promoEd.tipo=t;pedPromoForm();};
  window.pedPromoLocal=function(){promoLeer();promoEd.categorias=[];pedPromoForm();};
  function precioProd(c){var P=promoProds;var x=c.origen==='asadito'?P.a.find(function(z){return z.id===c.id;}):P.b.find(function(z){return z.id===c.id;});return x?Number(c.origen==='asadito'?x.precio:x.precio_venta):0;}
  function nombreProd(c){var P=promoProds;var x=c.origen==='asadito'?P.a.find(function(z){return z.id===c.id;}):P.b.find(function(z){return z.id===c.id;});return x?x.nombre:'(no disponible)';}
  window.pedComboAdd=function(){promoLeer();var v=g('pp-prod').value;if(!v)return;var o=v.split('|');var q=Math.max(1,Number(g('pp-cant').value)||1);
    var ex=promoEd.combo.find(function(c){return c.origen===o[0]&&c.id===o[1];});if(ex)ex.cantidad+=q;else promoEd.combo.push({origen:o[0],id:o[1],cantidad:q});pedPromoForm();};
  window.pedComboFoto=async function(inp){
    var f=inp.files&&inp.files[0];inp.value='';if(!f)return;promoLeer();
    if((promoEd.imagenes||[]).length>=3){toast('Máximo 3 fotos','err');return;}
    try{toast('Subiendo foto…');
      var blob=await fotoWebp(f),path='combos/'+Date.now()+'-'+Math.random().toString(36).slice(2,7)+'.webp';
      var up=await sb.storage.from('productos').upload(path,blob,{contentType:'image/webp',cacheControl:'31536000',upsert:false});
      if(up.error) throw up.error;
      promoEd.imagenes=(promoEd.imagenes||[]).concat(sb.storage.from('productos').getPublicUrl(path).data.publicUrl);
      toast('📷 Foto lista · tocá Guardar');pedPromoForm();
    }catch(e){toast('No se pudo subir la foto: '+(e.message||e),'err');}
  };
  window.pedComboFotoQuitar=function(i){promoLeer();promoEd.imagenes.splice(i,1);pedPromoForm();};
  window.pedComboQuitar=function(i){promoLeer();promoEd.combo.splice(i,1);pedPromoForm();};
  function pedPromoForm(){
    var e=promoEd,P=promoProds,box=g('promo-form');if(!box)return;
    var catsA=['ASADITO','EMBUTIDO','BEBIDA','OTROS'],cats=e.local==='asadito'?catsA:e.local==='bodega'?P.cats:catsA.concat(P.cats);
    var normal=(e.combo||[]).reduce(function(a,c){return a+precioProd(c)*c.cantidad;},0);
    var html='<div class="form-grid">'+
      '<div class="form-group" style="grid-column:1/-1"><label>Tipo</label><select onchange="pedPromoTipo(this.value)">'+Object.keys(TIPOS_P).map(function(k){return '<option value="'+k+'"'+(e.tipo===k?' selected':'')+'>'+TIPOS_P[k]+'</option>';}).join('')+'</select></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>Nombre</label><input id="pp-nombre" value="'+h(e.nombre)+'" placeholder="Ej: Lunes de combo"></div>';
    if(e.tipo==='delivery_gratis') html+='<div class="form-group"><label>Monto mínimo (Gs.)</label><input id="pp-min" inputmode="numeric" value="'+(e.monto_minimo||0)+'"></div>'+
      '<div class="form-group"><label>Cuenta el monto de</label><select id="pp-local"><option value="">Todo el pedido</option><option value="asadito"'+(e.local==='asadito'?' selected':'')+'>Solo asadito</option><option value="bodega"'+(e.local==='bodega'?' selected':'')+'>Solo bodega</option></select></div>';
    if(e.tipo==='descuento') html+='<div class="form-group"><label>Descuento %</label><input id="pp-pct" type="number" min="1" max="90" value="'+(e.porcentaje||10)+'"></div>'+
      '<div class="form-group"><label>Local</label><select id="pp-local" onchange="pedPromoLocal()"><option value="">Ambos</option><option value="asadito"'+(e.local==='asadito'?' selected':'')+'>Asadito</option><option value="bodega"'+(e.local==='bodega'?' selected':'')+'>Bodega</option></select></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>Categorías (si no marcás ninguna, aplica a todo el local)</label><div style="display:flex;flex-wrap:wrap;gap:6px 14px">'+cats.map(function(c){return '<label style="display:flex;gap:5px;align-items:center;margin:0;cursor:pointer;font-size:13px"><input type="checkbox" class="pp-cat" value="'+h(c)+'" style="width:auto" '+(e.categorias.indexOf(c)>=0?'checked':'')+'> '+h(c)+'</label>';}).join('')+'</div></div>'+
      '<div class="form-group"><label>Compra mínima (Gs., opcional)</label><input id="pp-min" inputmode="numeric" value="'+(e.monto_minimo||0)+'"></div>';
    if(e.tipo==='combo') html+='<div class="form-group" style="grid-column:1/-1"><label>Productos del combo</label>'+
      ((e.combo||[]).length?(e.combo||[]).map(function(c,i){return '<div class="ped-it" style="padding:4px 0"><span>'+c.cantidad+'× '+h(nombreProd(c))+' <span class="ped-meta">('+c.origen+')</span></span><span>'+fmtGs(precioProd(c)*c.cantidad)+' <button class="btn btn-secondary btn-sm" onclick="pedComboQuitar('+i+')">✕</button></span></div>';}).join(''):'<div class="ped-meta">Agregá productos abajo.</div>')+
      '<div style="display:flex;gap:6px;margin-top:8px"><select id="pp-prod" style="flex:1"><option value="">Elegí un producto…</option><optgroup label="🔥 Asadito">'+P.a.map(function(x){return '<option value="asadito|'+x.id+'">'+h(x.nombre)+' · '+fmtGs(x.precio)+'</option>';}).join('')+'</optgroup><optgroup label="🛒 Bodega (sin retornables)">'+P.b.map(function(x){return '<option value="bodega|'+x.id+'">'+h(x.nombre)+' · '+fmtGs(x.precio_venta)+'</option>';}).join('')+'</optgroup></select>'+
      '<input id="pp-cant" type="number" min="1" value="1" style="width:70px"><button class="btn btn-secondary btn-sm" onclick="pedComboAdd()">Agregar</button></div>'+
      '<div class="ped-meta" style="margin-top:6px">Precio normal: <b>'+fmtGs(normal)+'</b></div></div>'+
      '<div class="form-group"><label>Precio del combo (Gs.)</label><input id="pp-precio" inputmode="numeric" value="'+(e.precio||'')+'"></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>Fotos del combo (hasta 3; si no cargás, se usan las de los productos)</label><div style="display:flex;gap:8px;flex-wrap:wrap">'+
      (e.imagenes||[]).map(function(u,i){return '<div style="position:relative;width:76px;height:76px;border-radius:12px;overflow:hidden;border:1px solid var(--border)"><img src="'+h(u)+'" alt="" style="width:100%;height:100%;object-fit:cover"><button type="button" title="Quitar" onclick="pedComboFotoQuitar('+i+')" style="position:absolute;top:2px;right:2px;width:24px;height:24px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;line-height:1">✕</button></div>';}).join('')+
      ((e.imagenes||[]).length<3?'<label style="width:76px;height:76px;border-radius:12px;border:1px dashed var(--border2,#ccc);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-size:24px;margin:0">📷<span style="font-size:11px">Agregar</span><input type="file" accept="image/*" hidden onchange="pedComboFoto(this)"></label>':'')+
      '</div></div>';
    if(e.tipo==='fidelidad') html+='<div class="form-group"><label>Cada cuántos pedidos</label><input id="pp-n" type="number" min="2" value="'+(e.cada_n||5)+'"></div><div class="form-group ped-meta" style="align-self:end">El pedido siguiente lleva delivery gratis (ej: cada 5, el 6º).</div>';
    html+='<div class="form-group" style="grid-column:1/-1"><label>Días (si no marcás ninguno, todos los días)</label><div style="display:flex;flex-wrap:wrap;gap:6px 14px">'+DIAS_C.map(function(d){return '<label style="display:flex;gap:5px;align-items:center;margin:0;cursor:pointer"><input type="checkbox" class="pp-dia" value="'+d[0]+'" style="width:auto" '+(e.dias.indexOf(d[0])>=0?'checked':'')+'> '+d[1]+'</label>';}).join('')+'</div></div>'+
      '<div class="form-group"><label>Desde (opcional)</label><input id="pp-desde" type="time" value="'+h(e.hora_desde)+'"></div><div class="form-group"><label>Hasta (opcional)</label><input id="pp-hasta" type="time" value="'+h(e.hora_hasta==='24:00'?'00:00':e.hora_hasta)+'"></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>Texto del cartel (opcional; si lo dejás vacío se arma solo)</label><input id="pp-mensaje" value="'+h(e.mensaje)+'"></div>'+
      '<div class="form-group"><label>Orden</label><input id="pp-orden" type="number" value="'+(e.orden||0)+'"></div></div>';
    box.innerHTML=html;
  }
  async function pedPromoGuardar(){
    promoLeer();var e=promoEd;
    if(e.nombre.length<2){toast('Poné un nombre','err');return;}
    if(e.tipo==='descuento'&&!(e.porcentaje>0&&e.porcentaje<=90)){toast('El descuento debe ser entre 1 y 90%','err');return;}
    if(e.tipo==='combo'){if(!e.combo.length){toast('Agregá productos al combo','err');return;}if(!(e.precio>0)){toast('Poné el precio del combo','err');return;}}
    if(e.tipo==='fidelidad'&&!(e.cada_n>=2)){toast('Cada cuántos pedidos: mínimo 2','err');return;}
    if((e.hora_desde&&!e.hora_hasta)||(!e.hora_desde&&e.hora_hasta)){toast('Completá desde y hasta, o dejá los dos vacíos','err');return;}
    var obj={nombre:e.nombre,tipo:e.tipo,activa:e.activa!==false,dias:e.dias.length&&e.dias.length<7?e.dias:null,
      hora_desde:e.hora_desde||null,hora_hasta:e.hora_hasta?(e.hora_hasta==='00:00'?'24:00':e.hora_hasta):null,
      local:(e.tipo==='delivery_gratis'||e.tipo==='descuento')&&e.local?e.local:null,
      monto_minimo:(e.tipo==='delivery_gratis'||e.tipo==='descuento')?e.monto_minimo:0,
      porcentaje:e.tipo==='descuento'?e.porcentaje:null,categorias:e.tipo==='descuento'&&e.categorias.length?e.categorias:null,
      combo:e.tipo==='combo'?e.combo:null,imagenes:e.tipo==='combo'&&(e.imagenes||[]).length?e.imagenes.slice(0,3):null,precio:e.tipo==='combo'?e.precio:null,cada_n:e.tipo==='fidelidad'?e.cada_n:null,
      mensaje:e.mensaje||null,orden:e.orden||0,updated_at:new Date().toISOString()};
    var r=e.id?await sb.from('pedidos_promos').update(obj).eq('id',e.id):await sb.from('pedidos_promos').insert(obj);
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast('Promoción guardada');closeModal();pedRenderPromos();
  }

  // ─── CONFIGURACIÓN ───
  async function pedRenderConfig(){
    var b=g('ped-body'); if(!b) return;
    var r=await sb.from('pedidos_config').select('*').eq('id',1).maybeSingle();
    if(r.error){b.innerHTML='<div class="alert alert-error">Error: '+h(r.error.message)+'</div>';return;}
    var c=r.data||{};
    var rc=await sb.from('bodega_categorias').select('nombre').order('nombre'), c18=c.categorias_18||[];
    b.innerHTML='<div class="card" style="max-width:640px"><div class="card-header"><h3>Pedidos online</h3></div><div style="padding:14px">'+
      '<label style="display:flex;gap:10px;align-items:center;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:14px"><input type="checkbox" id="pc-abierto" style="width:22px;height:22px" '+(c.abierto?'checked':'')+'> Recibiendo pedidos (abierto)</label>'+
      '<label style="display:flex;gap:10px;align-items:center;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:14px"><input type="checkbox" id="pc-promo1" style="width:20px;height:20px" '+(c.promo_delivery_primera?'checked':'')+'> 🎉 Delivery gratis en la primera compra online <span class="ped-meta">(se reconoce por el número de WhatsApp)</span></label>'+
      '<div class="form-grid">'+
      '<div class="form-group"><label>Costo delivery (Gs.)</label><input id="pc-deliv" inputmode="numeric" value="'+(Number(c.costo_delivery)||0)+'"></div>'+
      '<div class="form-group"><label>Demora delivery (lo ve el cliente)</label><input id="pc-dem-d" placeholder="30–45 min" value="'+h(c.demora_delivery||'')+'"></div>'+
      '<div class="form-group"><label>Demora retiro en local</label><input id="pc-dem-r" placeholder="15–20 min" value="'+h(c.demora_retiro||'')+'"></div>'+
      '<div class="form-group"><label>Pedido mínimo (Gs.)</label><input id="pc-min" inputmode="numeric" value="'+(Number(c.pedido_minimo)||0)+'"></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>WhatsApp del local (para que el cliente avise)</label><input id="pc-wa" placeholder="595981123456" value="'+h(c.whatsapp||'')+'"></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>Formas de pago aceptadas</label><div class="ped-acts">'+Object.keys(PAGO_LBL).map(function(m){var on=(c.metodos_pago||['efectivo','transferencia']).indexOf(m)>=0;return '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;margin-right:12px"><input type="checkbox" class="pc-pago" value="'+m+'" style="width:auto" '+(on?'checked':'')+'> '+PAGO_LBL[m]+'</label>';}).join('')+'</div></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>Horarios de pedidos (hora de Paraguay)</label>'+horariosHtml(c.horarios||{})+'<div class="ped-meta">Fuera de horario la página muestra ese local como cerrado y no acepta sus productos. Cierre 00:00 = medianoche.</div></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>🛵 Zona de delivery (distancia en línea recta desde el local)</label>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><input id="pc-lat" placeholder="Latitud (o pegá las coordenadas)" oninput="pedCoordsPegar(this)" value="'+(c.local_lat!=null?c.local_lat:'')+'" style="width:140px"><input id="pc-lng" placeholder="Longitud -57.50" value="'+(c.local_lng!=null?c.local_lng:'')+'" style="width:140px">'+
      '<button type="button" class="btn btn-secondary btn-sm" onclick="pedUbiLocal()">📍 Usar mi ubicación actual</button>'+(c.local_lat!=null?'<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://maps.google.com/?q='+c.local_lat+','+c.local_lng+'">Ver en mapa</a>':'')+'</div>'+
      '<div id="pc-zonas" style="margin-top:8px">'+(c.zonas_delivery||[]).map(zonaRow).join('')+'</div>'+
      '<button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="pedZonaAgregar()">+ Agregar zona</button>'+
      '<div class="ped-meta">Tocá «Usar mi ubicación actual» estando en el local. Más lejos que la última zona = fuera de cobertura (solo retiro). Sin ubicación del local se cobra el costo fijo de arriba; si el cliente no comparte su ubicación, también.</div></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>🔞 Categorías solo para mayores de 18</label><div class="ped-acts">'+(rc.data||[]).map(function(x){return '<label style="display:flex;gap:6px;align-items:center;cursor:pointer;margin-right:12px"><input type="checkbox" class="pc-18" value="'+h(x.nombre)+'" style="width:auto" '+(c18.indexOf(x.nombre)>=0?'checked':'')+'> '+h(x.nombre)+'</label>';}).join('')+'</div>'+
      '<div class="ped-meta">Si el pedido tiene productos de estas categorías, el cliente tiene que confirmar que es mayor de 18 y el repartidor ve el aviso para pedir la cédula.</div></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>🛵 Repartidores</label><div id="pc-reps">'+(c.repartidores||[]).map(repRow).join('')+'</div>'+
      '<button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="pedRepAgregar()">+ Agregar repartidor</button>'+
      '<div class="ped-meta">En cada pedido con delivery tocá «🛵 Enviar al delivery» y le llega por WhatsApp un link con los datos del cliente.</div></div>'+
      '<div class="form-group" style="grid-column:1/-1"><label>Mensaje en la página (horario, zona de delivery, alias de transferencia…)</label><textarea id="pc-msg" rows="3">'+h(c.mensaje||'')+'</textarea></div>'+
      '</div><button class="btn btn-primary" onclick="pedGuardarConfig()">Guardar</button>'+
      '<div class="alert" style="margin-top:14px">Link para tus clientes (Instagram, WhatsApp, QR):<br><b>'+h(URL_PUBLICA)+'</b><br><button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="pedCopiarLink()">Copiar link</button> <a class="btn btn-secondary btn-sm" style="margin-top:8px" target="_blank" rel="noopener" href="'+h(URL_PUBLICA)+'">Abrir</a></div>'+
      '</div></div>'+
      '<div class="card" style="max-width:640px;margin-top:14px"><div class="card-header"><h3>🔔 Avisos en este dispositivo</h3></div><div style="padding:14px">'+
      '<p class="ped-meta" style="margin-bottom:10px">Te llega una notificación por cada pedido nuevo aunque la app esté cerrada. Activalo en cada celular o compu que quieras que suene.<br>En iPhone: primero agregá la app a la pantalla de inicio (Compartir → Agregar a inicio) y abrila desde ahí.</p>'+
      '<div id="ped-push-estado" class="ped-meta" style="margin-bottom:10px">Comprobando…</div>'+
      '<div class="form-grid" style="margin-bottom:12px"><div class="form-group"><label>Tono con la app abierta</label><select id="pc-tono" onchange="pedTonoGuardar()">'+Object.keys(TONOS).map(function(k){return '<option value="'+k+'"'+(tonoCfg().tono===k?' selected':'')+'>'+TONOS[k].n+'</option>';}).join('')+'</select></div>'+
      '<div class="form-group"><label>&nbsp;</label><label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="pc-repetir" style="width:auto" onchange="pedTonoGuardar()" '+(tonoCfg().repetir?'checked':'')+'> Repetir hasta aceptar el pedido</label></div></div>'+
      '<p class="ped-meta" style="margin-bottom:10px">El tono se guarda en este dispositivo. Con la app cerrada suena el tono de notificaciones del celular (en Android se cambia en Ajustes → Apps → Guaripola → Notificaciones).</p>'+
      '<div class="ped-acts"><button class="btn btn-secondary btn-sm" onclick="pedTonoProbar()">▶ Probar tono</button><button class="btn btn-primary btn-sm" onclick="pedPushActivar()">Activar avisos</button><button class="btn btn-secondary btn-sm" onclick="pedPushProbar()">Enviar prueba</button><button class="btn btn-secondary btn-sm" onclick="pedPushDesactivar()">Desactivar</button></div>'+
      '</div></div>';
    pedPushEstado();
    var d=document.createElement('div');d.className='card';d.style.cssText='max-width:640px;margin-top:14px';
    d.innerHTML='<div class="card-header"><h3>🧾 Padrón de RUC (DNIT)</h3></div><div style="padding:14px"><p class="ped-meta" style="margin-bottom:10px">Con esto la página completa sola la razón social cuando el cliente escribe su RUC. Conviene actualizarlo una vez al mes.</p><div id="ruc-estado" class="ped-meta" style="margin-bottom:10px">Cargando…</div><button class="btn btn-secondary btn-sm" onclick="pedRucActualizar()">⟳ Actualizar padrón</button></div>';
    b.appendChild(d);pedRucEstado();
  }
  async function pedRucEstado(){
    var el=g('ruc-estado');if(!el)return;
    var r=await sb.from('ruc_padron_log').select('*').order('archivo');
    var L=r.data||[];if(!L.length){el.textContent='Todavía no se importó.';return;}
    var ok=L.filter(function(x){return x.estado==='ok';}),err=L.filter(function(x){return x.estado==='error';}),corriendo=L.some(function(x){return x.estado==='descargando'||x.estado==='importando';});
    var total=ok.reduce(function(a,x){return a+(x.filas||0);},0),ult=L.reduce(function(a,x){return x.updated_at>a?x.updated_at:a;},'');
    el.innerHTML='Archivos listos: <b>'+ok.length+'/10</b> · '+total.toLocaleString('es-PY')+' RUC · última actualización '+new Date(ult).toLocaleString('es-PY')+
      (err.length?'<br><span style="color:var(--red)">Con error: '+err.map(function(x){return 'ruc'+x.archivo;}).join(', ')+'</span>':'')+(corriendo?'<br>⏳ Importando…':'');
    if(corriendo)setTimeout(pedRucEstado,5000);
  }
  window.pedRucActualizar=async function(){
    if(!(await bgConfirm('Se descargan los 10 archivos de la DNIT (tarda unos minutos). ¿Continuar?',{title:'Actualizar padrón RUC',confirmText:'Actualizar'})))return;
    for(var n=0;n<10;n++){ var r=await sb.functions.invoke('ruc-importar',{body:{archivo:n}}); if(r.error){toast('Error: '+r.error.message,'err');break;} await new Promise(function(res){setTimeout(res,8000);}); }
    toast('Actualización iniciada');pedRucEstado();
  };
  function repRow(x){return '<div class="pc-rep" data-tk="'+h(x&&x.token||'')+'" style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap"><input class="pr-nom" placeholder="Nombre" value="'+h(x&&x.nombre||'')+'" style="flex:1;padding:4px 6px"><input class="pr-tel" placeholder="WhatsApp 0981…" inputmode="tel" value="'+h(x&&x.tel||'')+'" style="width:150px;padding:4px 6px">'+(x&&x.token?'<button type="button" class="btn btn-secondary btn-sm" onclick="pedRepLink(this)">🔗 Mandar su link</button>':'')+'<button type="button" class="btn btn-secondary btn-sm" onclick="this.parentNode.remove()">✕</button></div>';}
  window.pedRepLink=function(b){var r=b.parentNode,n=r.querySelector('.pr-nom').value.trim(),t=r.querySelector('.pr-tel').value;
    var m='Hola '+n+' 👋 Este es tu link de entregas de Guaripola. Guardalo: ahí ves tus pedidos de la noche y cuántas entregas hiciste.\n'+URL_ENTREGA+'?r='+r.dataset.tk;
    window.open('https://wa.me/'+waNum(t)+'?text='+encodeURIComponent(m),'_blank');};
  window.pedRepAgregar=function(){g('pc-reps').insertAdjacentHTML('beforeend',repRow(null));};
  function zonaRow(z){return '<div class="pc-zona" style="display:flex;gap:6px;align-items:center;margin-top:6px">Hasta <input class="pz-km" inputmode="decimal" value="'+(z&&z.km!=null?z.km:'')+'" style="width:70px;padding:4px 6px"> km · Gs. <input class="pz-pr" inputmode="numeric" value="'+(z&&z.precio!=null?z.precio:'')+'" style="width:110px;padding:4px 6px"><button type="button" class="btn btn-secondary btn-sm" onclick="this.parentNode.remove()">✕</button></div>';}
  window.pedZonaAgregar=function(){g('pc-zonas').insertAdjacentHTML('beforeend',zonaRow(null));};
  // Acepta lo que copia Google Maps: 25°18'18.7"S 57°30'23.0"W o -25.305194, -57.506389
  window.pedCoordsPegar=function(el){
    var s=el.value,m=s.match(/(\d+)°\s*(\d+)['′]\s*([\d.,]+)["″]?\s*([NS])[\s,]+(\d+)°\s*(\d+)['′]\s*([\d.,]+)["″]?\s*([EOW])/i),la,lo;
    if(m){var d=function(a,b,c){return +a+(+b)/60+parseFloat(String(c).replace(',','.'))/3600;};la=d(m[1],m[2],m[3])*(/S/i.test(m[4])?-1:1);lo=d(m[5],m[6],m[7])*(/[OW]/i.test(m[8])?-1:1);}
    else{m=s.match(/(-?\d{1,3}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);if(m){la=+m[1];lo=+m[2];}}
    if(la==null)return;
    el.value=la.toFixed(6);g('pc-lng').value=lo.toFixed(6);toast('Coordenadas cargadas. Tocá Guardar.');
  };
  window.pedUbiLocal=function(){
    if(!navigator.geolocation){toast('Este dispositivo no permite ubicación','err');return;}
    toast('Obteniendo ubicación…');
    navigator.geolocation.getCurrentPosition(function(p){g('pc-lat').value=p.coords.latitude.toFixed(6);g('pc-lng').value=p.coords.longitude.toFixed(6);toast('Ubicación cargada (precisión '+Math.round(p.coords.accuracy)+' m). Tocá Guardar.');},
      function(e){toast(e&&e.code===1?'Sin permiso de ubicación: habilitalo para esta app/navegador en los ajustes del celular, o pegá las coordenadas de Google Maps en Latitud.':'No se pudo obtener la ubicación. Pegá las coordenadas de Google Maps en el campo Latitud.','err');},{enableHighAccuracy:true,timeout:15000});
  };
  var DIAS_H=[[1,'Lunes'],[2,'Martes'],[3,'Miércoles'],[4,'Jueves'],[5,'Viernes'],[6,'Sábado'],[0,'Domingo']];
  function horariosHtml(hs){
    return '<div class="ped-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">'+[['asadito','🔥 Asadito'],['bodega','🛒 Bodega']].map(function(L){
      var h=hs[L[0]]||{};
      return '<div style="border:1px solid var(--border);border-radius:10px;padding:10px"><b>'+L[1]+'</b>'+DIAS_H.map(function(d){
        var r=h[d[0]], on=!!r, a=r?r[0]:'18:00', c=r?(r[1]==='24:00'?'00:00':r[1]):'23:00';
        return '<div style="display:flex;gap:6px;align-items:center;margin-top:6px"><label style="display:flex;gap:6px;align-items:center;width:110px;margin:0;cursor:pointer"><input type="checkbox" class="ph-on" data-l="'+L[0]+'" data-d="'+d[0]+'" style="width:auto" '+(on?'checked':'')+'> '+d[1]+'</label>'+
          '<input type="time" class="ph-a" data-l="'+L[0]+'" data-d="'+d[0]+'" value="'+a+'" style="width:auto;padding:4px 6px"> a <input type="time" class="ph-c" data-l="'+L[0]+'" data-d="'+d[0]+'" value="'+c+'" style="width:auto;padding:4px 6px"></div>';
      }).join('')+'</div>';
    }).join('')+'</div>';
  }
  function leerHorarios(){
    var out={asadito:{},bodega:{}};
    document.querySelectorAll('.ph-on').forEach(function(cb){
      if(!cb.checked) return;
      var l=cb.dataset.l, d=cb.dataset.d, q=function(c){return document.querySelector('.'+c+'[data-l="'+l+'"][data-d="'+d+'"]').value;};
      var a=q('ph-a')||'00:00', c=q('ph-c')||'00:00'; if(c==='00:00') c='24:00';
      out[l][d]=[a,c];
    });
    return out;
  }
  window.pedGuardarConfig=async function(){
    var num=function(id){return Number(String(g(id).value).replace(/\D/g,''))||0;};
    var obj={abierto:g('pc-abierto').checked,promo_delivery_primera:g('pc-promo1').checked,costo_delivery:num('pc-deliv'),pedido_minimo:num('pc-min'),whatsapp:waNum(g('pc-wa').value)||null,mensaje:g('pc-msg').value.trim()||null,metodos_pago:[].slice.call(document.querySelectorAll('.pc-pago:checked')).map(function(x){return x.value;}),updated_at:new Date().toISOString()};
    if(!obj.metodos_pago.length){toast('Elegí al menos una forma de pago','err');return;}
    obj.horarios=leerHorarios();
    var lat=parseFloat(String(g('pc-lat').value).replace(',','.')),lng=parseFloat(String(g('pc-lng').value).replace(',','.'));
    if(String(g('pc-lat').value).trim()||String(g('pc-lng').value).trim()){
      if(!(Math.abs(lat)<=90&&Math.abs(lng)<=180)){toast('Revisá la latitud y longitud del local','err');return;}
      obj.local_lat=lat;obj.local_lng=lng;
    }else{obj.local_lat=null;obj.local_lng=null;}
    obj.demora_delivery=g('pc-dem-d').value.trim()||'30–45 min';obj.demora_retiro=g('pc-dem-r').value.trim()||'15–20 min';
    obj.categorias_18=[].slice.call(document.querySelectorAll('.pc-18:checked')).map(function(x){return x.value;});
    obj.repartidores=[].slice.call(document.querySelectorAll('.pc-rep')).map(function(r){return {nombre:r.querySelector('.pr-nom').value.trim(),tel:r.querySelector('.pr-tel').value.trim(),token:r.dataset.tk||uuid()};}).filter(function(x){return x.nombre&&x.tel.replace(/\D/g,'').length>=6;});
    obj.zonas_delivery=[].slice.call(document.querySelectorAll('.pc-zona')).map(function(r){return {km:parseFloat(String(r.querySelector('.pz-km').value).replace(',','.')),precio:Number(String(r.querySelector('.pz-pr').value).replace(/\D/g,''))};})
      .filter(function(z){return z.km>0&&z.precio>=0;}).sort(function(a,b){return a.km-b.km;});
    var r=await sb.from('pedidos_config').update(obj).eq('id',1);
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast('Configuración guardada'); pedRenderConfig();
  };
  window.pedCopiarLink=function(){try{navigator.clipboard.writeText(URL_PUBLICA);toast('Link copiado');}catch(e){toast(URL_PUBLICA);}};

  // ─── NOTIFICACIONES PUSH (llegan con la app cerrada) ───
  var VAPID_PUB='BEHw4lGnSRPHbMLOPz1lHnt_4PXDWVaRzAYrLqeFp0KQi-43_tukauIFLeQLOKfApEIOmVHmvW6LfBU2XFHIODE';
  function b64u(s){s=s.replace(/-/g,'+').replace(/_/g,'/');s+='='.repeat((4-s.length%4)%4);var r=atob(s),a=new Uint8Array(r.length);for(var i=0;i<r.length;i++)a[i]=r.charCodeAt(i);return a;}
  function pushOk(){return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;}
  async function pushSub(){if(!pushOk())return null;var reg=await navigator.serviceWorker.ready;return reg.pushManager.getSubscription();}
  async function pedPushEstado(){
    var el=g('ped-push-estado'); if(!el) return;
    if(!pushOk()){el.innerHTML='⚠️ Este navegador no permite avisos. En iPhone, abrí la app desde el ícono de la pantalla de inicio.';return;}
    if(Notification.permission==='denied'){el.innerHTML='🚫 Bloqueaste las notificaciones. Habilitalas en los ajustes del navegador para este sitio.';return;}
    var sub=await pushSub().catch(function(){return null;});
    var n=await sb.from('push_suscripciones').select('id',{count:'exact',head:true});
    el.innerHTML=(sub?'✅ Activado en este dispositivo.':'⭕ No activado en este dispositivo.')+' Dispositivos con avisos: <b>'+(n.count||0)+'</b>';
  }
  window.pedPushActivar=async function(){
    try{
      if(!pushOk()){toast('Este navegador no permite avisos','err');return;}
      var perm=await Notification.requestPermission();
      if(perm!=='granted'){toast('Permiso de notificaciones denegado','err');pedPushEstado();return;}
      var reg=await navigator.serviceWorker.ready;
      var sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64u(VAPID_PUB)});
      var j=sub.toJSON(), u=null; try{u=JSON.parse(localStorage.getItem('bg_usuario_actual')||'null');}catch(e){}
      var r=await sb.from('push_suscripciones').upsert({endpoint:j.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth,usuario:u&&u.nombre||null,dispositivo:(navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||null},{onConflict:'endpoint'});
      if(r.error) throw r.error;
      toast('Avisos activados ✅'); pedPushEstado();
    }catch(e){toast('No se pudo activar: '+(e.message||e),'err');}
  };
  window.pedPushProbar=async function(){
    var r=await sb.functions.invoke('pedido-push',{body:{prueba:true}});
    if(r.error){toast('Error: '+r.error.message,'err');return;}
    toast('Prueba enviada a '+((r.data&&r.data.enviados)||0)+' dispositivo(s)');
  };
  window.pedPushDesactivar=async function(){
    try{var sub=await pushSub(); if(sub){await sb.from('push_suscripciones').delete().eq('endpoint',sub.endpoint);await sub.unsubscribe();}
      toast('Avisos desactivados en este dispositivo');}catch(e){toast('Error: '+(e.message||e),'err');}
    pedPushEstado();
  };
  // Abrir Pedidos al tocar la notificación
  var abrirPend=location.hash==='#pedidos';
  // Llegó desde la app Pedidos para cobrar la parte de bodega en la caja
  var cargarPend=new URLSearchParams(location.search).get('cargar');
  if('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message',function(e){if(e.data&&e.data.type==='OPEN_PEDIDOS'){tab='pedidos';filtro='activos';goTo('pedidos');}});

  // ─── AVISO DE PEDIDOS NUEVOS ───
  // Tonos generados (sin archivos). Cada nota: [frecuencia Hz, inicio s, duración s, forma]
  var TONOS={
    beep:{n:'Beep',notas:[[880,0,.18,'sine'],[1175,.18,.24,'sine']]},
    campana:{n:'Campana',notas:[[1319,0,1.2,'sine'],[1976,0,.8,'sine'],[1319,.45,1.2,'sine']]},
    timbre:{n:'Timbre (ding-dong)',notas:[[784,0,.6,'triangle'],[622,.55,.9,'triangle']]},
    alarma:{n:'Alarma',notas:[[988,0,.15,'square'],[784,.17,.15,'square'],[988,.34,.15,'square'],[784,.51,.15,'square'],[988,.68,.15,'square'],[784,.85,.15,'square']]},
    caja:{n:'Caja registradora',notas:[[2093,0,.08,'square'],[2637,.09,.08,'square'],[3136,.18,.5,'sine']]},
    silencio:{n:'Sin sonido',notas:[]}
  };
  var actx=null, repT=null;
  function tonoCfg(){try{return JSON.parse(localStorage.getItem('ped_tono')||'null')||{tono:'campana',repetir:true};}catch(e){return {tono:'campana',repetir:true};}}
  function audio(){try{if(!actx)actx=new (window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended')actx.resume();}catch(e){}return actx;}
  document.addEventListener('click',function(){audio();},{once:true,capture:true});
  function beep(k){
    var t=TONOS[k||tonoCfg().tono]||TONOS.beep, a=audio(); if(!a||!t.notas.length) return;
    var t0=a.currentTime+.02;
    t.notas.forEach(function(n){
      var o=a.createOscillator(),gn=a.createGain();o.type=n[3];o.frequency.value=n[0];o.connect(gn);gn.connect(a.destination);
      gn.gain.setValueAtTime(.0001,t0+n[1]);gn.gain.exponentialRampToValueAtTime(n[3]==='square'?.08:.25,t0+n[1]+.01);gn.gain.exponentialRampToValueAtTime(.0001,t0+n[1]+n[2]);
      o.start(t0+n[1]);o.stop(t0+n[1]+n[2]+.05);
    });
  }
  window.pedTonoGuardar=function(){try{localStorage.setItem('ped_tono',JSON.stringify({tono:g('pc-tono').value,repetir:g('pc-repetir').checked}));}catch(e){} beep(); if(!tonoCfg().repetir&&repT){clearInterval(repT);repT=null;}};
  window.pedTonoProbar=function(){beep(g('pc-tono')?g('pc-tono').value:null);};
  function repetir(hayPend){
    if(hayPend&&tonoCfg().repetir){ if(!repT) repT=setInterval(function(){beep();},8000); }
    else if(repT){clearInterval(repT);repT=null;}
  }
  async function pedPoll(){
    if(!sb) return;
    try{
      var s=await sb.auth.getSession(); if(!s||!s.data||!s.data.session) return;
      if(cargarPend&&typeof addToVenta==='function'){var cp=cargarPend;cargarPend=null;try{history.replaceState(null,'',location.pathname);}catch(e){} setTimeout(function(){pedCargarBodega(cp);},800);}
      if(abrirPend){abrirPend=false;try{history.replaceState(null,'',location.pathname);}catch(e){} setTimeout(function(){goTo('pedidos');},800);}
      var r=await sb.from('pedidos_online').select('id,numero,cliente_nombre,total').eq('estado','pendiente').order('created_at');
      if(r.error) return;
      var desde=repDesde;repDesde=new Date().toISOString();
      var rr=await sb.from('pedidos_online').select('numero,repartidor,salio_at,entregado_at').not('driver_token','is',null).gte('updated_at',desde);
      var cambio=false;
      (rr.data||[]).forEach(function(x){
        if(x.entregado_at&&x.entregado_at>=desde){cambio=true;toast('✅ Pedido #'+x.numero+' entregado'+(x.repartidor?' por '+x.repartidor:''));}
        else if(x.salio_at&&x.salio_at>=desde){cambio=true;toast('🛵 '+(x.repartidor||'El delivery')+' salió con el pedido #'+x.numero);}
      });
      if(cambio&&enPedidos()&&tab==='pedidos') pedRenderLista();
      var ps=r.data||[], bd=g('ped-badge');
      if(bd){bd.textContent=ps.length;bd.style.display=ps.length?'':'none';}
      repetir(ps.length>0);
      var nuevos=vistos?ps.filter(function(p){return !vistos[p.id];}):[];
      vistos={}; ps.forEach(function(p){vistos[p.id]=1;});
      if(nuevos.length){
        beep();
        nuevos.forEach(function(p){toast('🔔 Pedido nuevo #'+p.numero+' · '+p.cliente_nombre+' · '+fmtGs(p.total));});
        try{if(window.Notification&&Notification.permission==='granted')new Notification('Pedido nuevo #'+nuevos[0].numero,{body:nuevos[0].cliente_nombre+' · '+fmtGs(nuevos[0].total),icon:'icon-192.png',tag:'pedido-'+nuevos[0].numero});}catch(e){}
        if(enPedidos()&&tab==='pedidos') pedRenderLista();
      }
    }catch(e){}
  }
  window.pedPoll=pedPoll;
  function start(){
    if(pollT) return;
    pollT=setInterval(pedPoll,30000); setTimeout(pedPoll,4000); if(abrirPend||cargarPend) setTimeout(pedPoll,1500);
    document.addEventListener('click',function once(){document.removeEventListener('click',once);try{if(window.Notification&&Notification.permission==='default')Notification.requestPermission();}catch(e){}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
