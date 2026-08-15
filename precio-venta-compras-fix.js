/* Hotfix: persistencia real de precio de venta desde compras.
   - Actualiza producto o embalaje directamente en Supabase.
   - No finge éxito en caché cuando falla.
   - Revalida caché después de guardar.
*/
(function(){
  'use strict';

  var cambiosPendientes = new Map();

  function itemCompra(i){
    try { return (typeof compraItems !== 'undefined' && compraItems && compraItems[i]) ? compraItems[i] : null; }
    catch(e){ return null; }
  }

  function claveItem(item){
    if(!item || !item.producto_id) return null;
    return item.embalaje_id ? ('emb:' + item.embalaje_id) : ('prod:' + item.producto_id);
  }

  function registrarCambio(i){
    var item = itemCompra(i);
    var key = claveItem(item);
    if(!item || !key) return;
    var precio = Number(item.precio_venta);
    if(!Number.isFinite(precio) || precio < 0) return;
    cambiosPendientes.set(key, {
      key:key,
      producto_id:item.producto_id,
      embalaje_id:item.embalaje_id || null,
      nombre:item.nombre || 'Producto',
      precio_venta:precio
    });
  }

  function envolverEditor(nombre){
    var original = window[nombre];
    if(typeof original !== 'function' || original.__bgPrecioVentaFix) return;
    var wrapped = function(i,v){
      var r = original.apply(this, arguments);
      registrarCambio(i);
      return r;
    };
    wrapped.__bgPrecioVentaFix = true;
    wrapped.__original = original;
    window[nombre] = wrapped;
  }

  async function persistirCambios(lista){
    if(!lista.length) return {ok:true, errores:[]};
    var errores=[];

    for(var j=0;j<lista.length;j++){
      var c=lista[j];
      try{
        var q;
        if(c.embalaje_id){
          q = await sb.from('bodega_embalajes')
            .update({precio_venta:c.precio_venta})
            .eq('id',c.embalaje_id)
            .select('id,precio_venta')
            .single();
        }else{
          q = await sb.from('bodega_productos')
            .update({precio_venta:c.precio_venta})
            .eq('id',c.producto_id)
            .select('id,precio_venta')
            .single();
        }
        if(q.error) throw q.error;
        if(!q.data || Number(q.data.precio_venta)!==Number(c.precio_venta)){
          throw new Error('Supabase no confirmó el nuevo precio');
        }
      }catch(e){
        errores.push({cambio:c,error:(e && e.message) ? e.message : String(e)});
      }
    }

    return {ok:errores.length===0, errores:errores};
  }

  function envolverFinalizarCompra(){
    var original = window.finalizarCompra;
    if(typeof original !== 'function' || original.__bgPrecioVentaFix) return;

    var wrapped = async function(){
      var pendientes = Array.from(cambiosPendientes.values());
      var cantidadAntes = 0;
      try { cantidadAntes = (typeof compraItems !== 'undefined' && compraItems) ? compraItems.length : 0; } catch(e){}

      var resultado = await original.apply(this, arguments);

      var cantidadDespues = cantidadAntes;
      try { cantidadDespues = (typeof compraItems !== 'undefined' && compraItems) ? compraItems.length : cantidadAntes; } catch(e){}

      // Las versiones actuales vacían compraItems solamente cuando el guardado termina correctamente.
      var compraGuardada = cantidadAntes > 0 && cantidadDespues === 0;
      if(!compraGuardada || !pendientes.length) return resultado;

      var persistencia = await persistirCambios(pendientes);
      if(!persistencia.ok){
        var nombres = persistencia.errores.slice(0,3).map(function(x){return x.cambio.nombre;}).join(', ');
        if(typeof toast==='function'){
          toast('⚠️ Compra guardada, pero NO se pudo actualizar el precio de venta de: '+nombres+'. Revisá esos productos.','err');
        }
        console.error('[precio-venta-compras-fix] errores:', persistencia.errores);
        return resultado;
      }

      cambiosPendientes.clear();
      try { if(typeof loadCaches==='function') await loadCaches(true); } catch(e){}
      if(typeof toast==='function') toast('✓ Compra y precios de venta guardados correctamente');
      return resultado;
    };

    wrapped.__bgPrecioVentaFix = true;
    wrapped.__original = original;
    window.finalizarCompra = wrapped;
  }

  function instalar(){
    envolverEditor('cPrecioVenta');
    envolverEditor('cMargenVenta');
    envolverFinalizarCompra();
  }

  // Ejecutar al final de la carga y repetir una vez por si una versión tardía redefine funciones.
  instalar();
  setTimeout(instalar, 0);
  setTimeout(instalar, 800);
})();
