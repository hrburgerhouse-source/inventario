// ── Estado global ──────────────────────────────────────────────────────────
let pinIngresado = '';
let productos = [];
let diaHoyId = '';
let productoEditandoId = null;

// ── Zona horaria ───────────────────────────────────────────────────────────

function getFechaHoy() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function formatearFecha(fecha) {
  if (!fecha) return '—';
  const [y, m, d] = fecha.split('-');
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const dt = new Date(`${fecha}T12:00:00`);
  return `${dias[dt.getDay()]} ${d} ${meses[parseInt(m) - 1]} ${y}`;
}

function formatNum(n) {
  const num = parseFloat(n) || 0;
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

// ── PIN ────────────────────────────────────────────────────────────────────

function initPinPad() {
  document.querySelectorAll('.pin-tecla[data-digito]').forEach(tecla => {
    tecla.addEventListener('click', () => {
      if (pinIngresado.length >= 4) return;
      pinIngresado += tecla.dataset.digito;
      actualizarPuntos();
      if (pinIngresado.length === 4) verificarPin();
    });
  });

  document.getElementById('pinEliminar').addEventListener('click', () => {
    pinIngresado = pinIngresado.slice(0, -1);
    actualizarPuntos();
  });
}

function actualizarPuntos() {
  document.querySelectorAll('.pin-punto').forEach((p, i) => {
    p.classList.toggle('lleno', i < pinIngresado.length);
    p.classList.remove('error');
  });
}

async function verificarPin() {
  try {
    const snap = await db.collection('config').doc('admin').get();
    let pinCorrecto = '1234';

    if (!snap.exists) {
      await db.collection('config').doc('admin').set({ pin: '1234' });
    } else if (snap.data().pin) {
      pinCorrecto = snap.data().pin;
    }

    if (pinIngresado === pinCorrecto) {
      sessionStorage.setItem('adminOk', '1');
      mostrarPanelAdmin();
    } else {
      errorPin();
    }
  } catch (err) {
    console.error(err);
    showToast('Error de conexión con Firebase', 'error');
    pinIngresado = '';
    actualizarPuntos();
  }
}

function errorPin() {
  document.querySelectorAll('.pin-punto').forEach(p => {
    p.classList.remove('lleno');
    p.classList.add('error');
  });
  setTimeout(() => {
    document.querySelectorAll('.pin-punto').forEach(p => p.classList.remove('error'));
    pinIngresado = '';
    actualizarPuntos();
  }, 750);
  showToast('PIN incorrecto', 'error');
}

// ── Panel Admin ────────────────────────────────────────────────────────────

async function mostrarPanelAdmin() {
  document.getElementById('pinScreen').style.display = 'none';
  document.getElementById('adminPanel').style.display = 'block';
  diaHoyId = getFechaHoy();

  await cargarProductos();
  cambiarTab('inventario');
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function cambiarTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-admin .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`.nav-admin [data-tab="${tab}"]`).classList.add('active');

  if (tab === 'inventario') renderInventario();
  else if (tab === 'historial') renderHistorial();
  else if (tab === 'catalogo') renderCatalogo();
  // 'ajustes' es HTML estático
}

// ── Cargar productos ───────────────────────────────────────────────────────

async function cargarProductos() {
  const snap = await db.collection('productos').get();
  productos = snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (a.orden || 999) - (b.orden || 999) || a.nombre.localeCompare(b.nombre));
}

// ── TAB: Inventario actual ─────────────────────────────────────────────────

async function renderInventario() {
  const container = document.getElementById('tab-inventario');
  container.innerHTML = `<div class="skeleton" style="height:240px;"></div>`;

  try {
    const snap = await db.collection('dias').doc(diaHoyId).get();
    const diaData = snap.exists ? snap.data() : null;
    const activos = productos.filter(p => p.activo);
    const estado = diaData
      ? (diaData.estado === 'cerrado' ? '✅ Cerrado' : '🟡 Abierto')
      : 'Sin datos';

    let alertas = 0;

    let filas = '';
    for (const p of activos) {
      const item = diaData?.items?.[p.id] || { inicial: 0, entradas: 0, usado: 0, restante: 0 };
      const restante = parseFloat(item.inicial) + parseFloat(item.entradas) - parseFloat(item.usado);
      const esBajo = p.stockMinimo > 0 && restante < p.stockMinimo && restante >= p.stockMinimo * 0.5;
      const esCritico = p.stockMinimo > 0 && restante < p.stockMinimo * 0.5;
      if (esBajo || esCritico) alertas++;

      filas += `
        <tr>
          <td>
            <div style="font-weight:600;">${p.nombre}</div>
            <div style="font-size:0.72rem;color:var(--texto-muted);">${p.categoria} · ${p.unidad}</div>
          </td>
          <td>${formatNum(item.inicial)}</td>
          <td style="color:var(--exito)">${parseFloat(item.entradas) > 0 ? '+' + formatNum(item.entradas) : '—'}</td>
          <td>${formatNum(item.usado)}</td>
          <td style="${restante < 0 ? 'color:var(--peligro);font-weight:700;' : ''}">${formatNum(restante)}</td>
          <td>
            ${esCritico
              ? `<span class="badge-stock badge-critico">⚠ Crítico</span>`
              : esBajo
              ? `<span class="badge-stock badge-bajo">↓ Bajo</span>`
              : `<span style="color:var(--exito);">✓</span>`
            }
          </td>
        </tr>
      `;
    }

    container.innerHTML = `
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:700;">${formatearFecha(diaHoyId)}</div>
            <div style="font-size:0.8rem;color:var(--texto-muted);">Estado: ${estado}
              ${alertas > 0 ? `· <span style="color:var(--alerta);">⚠ ${alertas} alerta${alertas > 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
          ${diaData?.estado === 'cerrado'
            ? `<button class="btn btn-sm btn-secundario" onclick="reabrirDia('${diaHoyId}')">Reabrir día</button>`
            : ''}
        </div>
      </div>

      ${activos.length === 0
        ? `<div class="empty-state"><div class="icon">📦</div><p>No hay productos activos.<br>Configura el catálogo primero.</p></div>`
        : `<div class="tabla-wrapper">
             <table class="tabla">
               <thead><tr>
                 <th>Producto</th><th>Inicial</th><th>Entradas</th><th>Usado</th><th>Restante</th><th>Estado</th>
               </tr></thead>
               <tbody>${filas}</tbody>
             </table>
           </div>`
      }
    `;
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error al cargar el inventario.</p></div>`;
  }
}

// ── TAB: Historial ─────────────────────────────────────────────────────────

function renderHistorial() {
  const container = document.getElementById('tab-historial');
  container.innerHTML = `
    <div class="fecha-selector">
      <input type="date" id="historialFecha" value="${diaHoyId}">
      <button class="btn btn-primario btn-sm" onclick="verDetalleDia(document.getElementById('historialFecha').value)">Ver</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      <button class="btn btn-secundario btn-sm" onclick="exportarCSV()">📥 Exportar CSV (30 días)</button>
    </div>
    <div id="historialContenido"><div class="skeleton" style="height:280px;"></div></div>
  `;
  cargarListaHistorial();
}

async function cargarListaHistorial() {
  const cont = document.getElementById('historialContenido');
  if (!cont) return;

  try {
    const snap = await db.collection('dias').orderBy('fecha', 'desc').limit(30).get();

    if (snap.empty) {
      cont.innerHTML = `<div class="empty-state"><div class="icon">📅</div><p>No hay días registrados aún.</p></div>`;
      return;
    }

    cont.innerHTML = snap.docs.map(doc => {
      const d = doc.data();
      const qty = Object.keys(d.items || {}).length;
      const hora = d.cerradoAt?.seconds
        ? new Date(d.cerradoAt.seconds * 1000).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
        : '';

      return `
        <div class="dia-card" onclick="verDetalleDia('${d.fecha}')">
          <div>
            <div class="dia-fecha">${formatearFecha(d.fecha)}</div>
            <div class="dia-sub">${qty} producto${qty !== 1 ? 's' : ''}${hora ? ' · cerrado ' + hora : ''}</div>
          </div>
          <span class="chip ${d.estado === 'cerrado' ? 'chip-exito' : 'chip-alerta'}">
            ${d.estado === 'cerrado' ? '✅ Cerrado' : '🟡 Abierto'}
          </span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error al cargar historial.</p></div>`;
  }
}

async function verDetalleDia(fecha) {
  if (!fecha) return;
  const cont = document.getElementById('historialContenido');
  if (!cont) return;

  cont.innerHTML = `<div class="skeleton" style="height:280px;"></div>`;

  try {
    const snap = await db.collection('dias').doc(fecha).get();
    const volver = `<button class="btn btn-secundario btn-sm" onclick="cargarListaHistorial()" style="margin-bottom:14px;">← Historial</button>`;

    if (!snap.exists) {
      cont.innerHTML = `${volver}<div class="empty-state"><div class="icon">📅</div><p>Sin datos para esta fecha.</p></div>`;
      return;
    }

    const d = snap.data();
    const prodMap = {};
    productos.forEach(p => { prodMap[p.id] = p; });

    let filas = '';
    for (const [id, item] of Object.entries(d.items || {})) {
      const p = prodMap[id];
      const restante = parseFloat(item.inicial) + parseFloat(item.entradas) - parseFloat(item.usado);
      filas += `
        <tr>
          <td>
            <div style="font-weight:600;">${p?.nombre || id}</div>
            ${p ? `<div style="font-size:0.72rem;color:var(--texto-muted);">${p.unidad}</div>` : ''}
          </td>
          <td>${formatNum(item.inicial)}</td>
          <td style="color:var(--exito)">${parseFloat(item.entradas) > 0 ? '+' + formatNum(item.entradas) : '—'}</td>
          <td>${formatNum(item.usado)}</td>
          <td style="${restante < 0 ? 'color:var(--peligro);font-weight:700;' : ''}">${formatNum(restante)}</td>
        </tr>
      `;
    }

    cont.innerHTML = `
      ${volver}
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:700;font-size:1rem;">${formatearFecha(d.fecha)}</div>
            <div style="font-size:0.8rem;color:var(--texto-muted);">
              Estado: ${d.estado === 'cerrado' ? '✅ Cerrado' : '🟡 Abierto'}
            </div>
          </div>
          ${d.estado === 'cerrado'
            ? `<button class="btn btn-sm btn-secundario" onclick="reabrirDia('${fecha}')">Reabrir</button>`
            : ''}
        </div>
      </div>
      <div class="tabla-wrapper">
        <table class="tabla">
          <thead><tr>
            <th>Producto</th><th>Inicial</th><th>Entradas</th><th>Usado</th><th>Restante</th>
          </tr></thead>
          <tbody>${filas || '<tr><td colspan="5" style="text-align:center;color:var(--texto-muted);">Sin items</td></tr>'}</tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<button class="btn btn-secundario btn-sm" onclick="cargarListaHistorial()" style="margin-bottom:14px;">← Historial</button>
      <div class="empty-state"><div class="icon">⚠️</div><p>Error al cargar los datos.</p></div>`;
  }
}

async function reabrirDia(fecha) {
  if (!confirm(`¿Reabrir el día ${formatearFecha(fecha)}?\nEl empleado podrá modificar los datos.`)) return;
  mostrarSpinner();
  try {
    await db.collection('dias').doc(fecha).update({
      estado: 'abierto',
      cerradoAt: null,
      cerradoPor: null
    });
    showToast('Día reabierto correctamente', 'exito');
    if (fecha === diaHoyId) renderInventario();
    else cargarListaHistorial();
  } catch (err) {
    console.error(err);
    showToast('Error al reabrir el día', 'error');
  } finally {
    ocultarSpinner();
  }
}

async function exportarCSV() {
  mostrarSpinner();
  try {
    const snap = await db.collection('dias').orderBy('fecha', 'desc').limit(30).get();
    if (snap.empty) { showToast('No hay datos para exportar', 'info'); return; }

    const prodMap = {};
    productos.forEach(p => { prodMap[p.id] = p; });

    const filas = [['Fecha', 'Dia', 'Estado', 'Producto', 'Categoria', 'Unidad', 'Inicial', 'Entradas', 'Usado', 'Restante']];

    snap.docs.forEach(doc => {
      const d = doc.data();
      for (const [id, item] of Object.entries(d.items || {})) {
        const p = prodMap[id];
        const restante = parseFloat(item.inicial) + parseFloat(item.entradas) - parseFloat(item.usado);
        filas.push([
          d.fecha,
          formatearFecha(d.fecha),
          d.estado,
          p?.nombre || id,
          p?.categoria || '',
          p?.unidad || '',
          item.inicial,
          item.entradas,
          item.usado,
          restante
        ]);
      }
    });

    const csv = filas.map(f => f.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventario_hr_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('CSV exportado correctamente', 'exito');
  } catch (err) {
    console.error(err);
    showToast('Error al exportar', 'error');
  } finally {
    ocultarSpinner();
  }
}

// ── TAB: Catálogo ──────────────────────────────────────────────────────────

function renderCatalogo() {
  const container = document.getElementById('tab-catalogo');
  const activos = productos.filter(p => p.activo);
  const inactivos = productos.filter(p => !p.activo);

  let html = `
    <div class="catalogo-acciones">
      <button class="btn btn-primario btn-sm" onclick="abrirModalProducto()">+ Nuevo producto</button>
      <button class="btn btn-secundario btn-sm" onclick="importarCatalogo()">📥 Importar catálogo base</button>
    </div>
  `;

  if (productos.length === 0) {
    html += `<div class="empty-state"><div class="icon">📦</div><p>Sin productos.<br>Agrega uno o importa el catálogo base.</p></div>`;
    container.innerHTML = html;
    return;
  }

  if (activos.length > 0) {
    html += `<div class="seccion-titulo">Activos (${activos.length})</div>`;
    html += activos.map(htmlProductoCatalogo).join('');
  }

  if (inactivos.length > 0) {
    html += `<div class="seccion-titulo">Inactivos (${inactivos.length})</div>`;
    html += inactivos.map(p => htmlProductoCatalogo(p, true)).join('');
  }

  container.innerHTML = html;
}

function htmlProductoCatalogo(p, inactivo = false) {
  return `
    <div class="producto-catalogo" style="${inactivo ? 'opacity:0.55;' : ''}">
      <div class="producto-catalogo-info">
        <div class="producto-catalogo-nombre">${p.nombre}</div>
        <div class="producto-catalogo-sub">${p.categoria} · ${p.unidad}${p.stockMinimo ? ' · Mín: ' + p.stockMinimo : ''}</div>
      </div>
      <div class="producto-catalogo-acciones">
        <label class="switch" title="${p.activo ? 'Desactivar' : 'Activar'}">
          <input type="checkbox" ${p.activo ? 'checked' : ''} onchange="toggleActivo('${p.id}', this.checked)">
          <span class="slider-sw"></span>
        </label>
        <button class="btn btn-sm btn-secundario" onclick="abrirModalProducto('${p.id}')">Editar</button>
        <button class="btn btn-sm btn-peligro" onclick="eliminarProducto('${p.id}', '${p.nombre.replace(/'/g, "\\'")}')">🗑</button>
      </div>
    </div>
  `;
}

async function eliminarProducto(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"?\n\nEsta acción no se puede deshacer. El historial de días anteriores no se verá afectado.`)) return;
  mostrarSpinner();
  try {
    await db.collection('productos').doc(id).delete();
    await cargarProductos();
    renderCatalogo();
    showToast(`"${nombre}" eliminado`, 'exito');
  } catch (err) {
    console.error(err);
    showToast('Error al eliminar el producto', 'error');
  } finally {
    ocultarSpinner();
  }
}

// ── Modal producto ─────────────────────────────────────────────────────────

function abrirModalProducto(id = null) {
  productoEditandoId = id;
  const p = id ? productos.find(x => x.id === id) : null;

  document.getElementById('modalProdTitulo').textContent = id ? 'Editar producto' : 'Nuevo producto';
  document.getElementById('inputNombre').value = p?.nombre || '';
  document.getElementById('selectCategoria').value = p?.categoria || 'Carnes y Proteínas';
  document.getElementById('selectUnidad').value = p?.unidad || 'kg';
  document.getElementById('inputStockMin').value = p?.stockMinimo ?? 0;

  document.getElementById('modalProducto').style.display = 'flex';
  setTimeout(() => document.getElementById('inputNombre').focus(), 80);
}

function cerrarModalProducto() {
  document.getElementById('modalProducto').style.display = 'none';
  productoEditandoId = null;
}

async function guardarProducto() {
  const nombre = document.getElementById('inputNombre').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio', 'error'); return; }

  const data = {
    nombre,
    categoria: document.getElementById('selectCategoria').value,
    unidad: document.getElementById('selectUnidad').value,
    stockMinimo: parseFloat(document.getElementById('inputStockMin').value) || 0
  };

  cerrarModalProducto();
  mostrarSpinner();

  try {
    if (productoEditandoId) {
      await db.collection('productos').doc(productoEditandoId).update(data);
      showToast('Producto actualizado', 'exito');
    } else {
      const maxOrden = productos.reduce((mx, p) => Math.max(mx, p.orden || 0), 0);
      await db.collection('productos').add({ ...data, activo: true, orden: maxOrden + 1 });
      showToast('Producto creado', 'exito');
    }
    await cargarProductos();
    renderCatalogo();
  } catch (err) {
    console.error(err);
    showToast('Error al guardar el producto', 'error');
  } finally {
    ocultarSpinner();
  }
}

async function toggleActivo(id, activo) {
  mostrarSpinner();
  try {
    await db.collection('productos').doc(id).update({ activo });
    await cargarProductos();
    renderCatalogo();
    showToast(activo ? 'Producto activado' : 'Producto desactivado', 'exito');
  } catch (err) {
    console.error(err);
    showToast('Error al actualizar', 'error');
    await cargarProductos();
    renderCatalogo();
  } finally {
    ocultarSpinner();
  }
}

async function importarCatalogo() {
  if (!confirm('¿Importar catálogo base? Se agregarán ~15 productos típicos de hamburguesería.')) return;

  const catalogo = [
    { nombre: 'Carne de res molida',    categoria: 'Carnes y Proteínas',    unidad: 'kg',      stockMinimo: 5,  orden: 10 },
    { nombre: 'Pechuga de pollo',        categoria: 'Carnes y Proteínas',    unidad: 'kg',      stockMinimo: 3,  orden: 20 },
    { nombre: 'Tocino / Bacon',          categoria: 'Carnes y Proteínas',    unidad: 'kg',      stockMinimo: 2,  orden: 30 },
    { nombre: 'Pan de hamburguesa',      categoria: 'Bebidas e Insumos',     unidad: 'paquete', stockMinimo: 5,  orden: 40 },
    { nombre: 'Queso americano',         categoria: 'Salsas y Condimentos',  unidad: 'kg',      stockMinimo: 2,  orden: 50 },
    { nombre: 'Lechuga',                 categoria: 'Vegetales y Frescos',   unidad: 'kg',      stockMinimo: 2,  orden: 60 },
    { nombre: 'Tomate',                  categoria: 'Vegetales y Frescos',   unidad: 'kg',      stockMinimo: 2,  orden: 70 },
    { nombre: 'Cebolla',                 categoria: 'Vegetales y Frescos',   unidad: 'kg',      stockMinimo: 1,  orden: 80 },
    { nombre: 'Pepinillos',              categoria: 'Vegetales y Frescos',   unidad: 'bote',    stockMinimo: 2,  orden: 90 },
    { nombre: 'Ketchup',                 categoria: 'Salsas y Condimentos',  unidad: 'bote',    stockMinimo: 2,  orden: 100 },
    { nombre: 'Mostaza',                 categoria: 'Salsas y Condimentos',  unidad: 'bote',    stockMinimo: 1,  orden: 110 },
    { nombre: 'Mayonesa',                categoria: 'Salsas y Condimentos',  unidad: 'bote',    stockMinimo: 2,  orden: 120 },
    { nombre: 'Papas fritas (bolsa)',    categoria: 'Bebidas e Insumos',     unidad: 'bolsa',   stockMinimo: 5,  orden: 130 },
    { nombre: 'Aceite vegetal',          categoria: 'Salsas y Condimentos',  unidad: 'litro',   stockMinimo: 3,  orden: 140 },
    { nombre: 'Bebidas (cajas)',         categoria: 'Bebidas e Insumos',     unidad: 'caja',    stockMinimo: 2,  orden: 150 },
  ];

  mostrarSpinner();
  try {
    const batch = db.batch();
    catalogo.forEach(p => {
      batch.set(db.collection('productos').doc(), { ...p, activo: true });
    });
    await batch.commit();
    await cargarProductos();
    renderCatalogo();
    showToast('Catálogo base importado (15 productos)', 'exito');
  } catch (err) {
    console.error(err);
    showToast('Error al importar catálogo', 'error');
  } finally {
    ocultarSpinner();
  }
}

// ── Cambio de PIN ──────────────────────────────────────────────────────────

function mostrarCambiarPin() {
  document.getElementById('inputPinActual').value = '';
  document.getElementById('inputPinNuevo').value = '';
  document.getElementById('inputPinConfirmar').value = '';
  document.getElementById('modalCambiarPin').style.display = 'flex';
}

function cerrarCambiarPin() {
  document.getElementById('modalCambiarPin').style.display = 'none';
}

async function guardarNuevoPin() {
  const actual = document.getElementById('inputPinActual').value;
  const nuevo = document.getElementById('inputPinNuevo').value;
  const confirmar = document.getElementById('inputPinConfirmar').value;

  if (!/^\d{4}$/.test(nuevo)) {
    showToast('El nuevo PIN debe tener exactamente 4 dígitos', 'error'); return;
  }
  if (nuevo !== confirmar) {
    showToast('Los PINs nuevos no coinciden', 'error'); return;
  }

  mostrarSpinner();
  try {
    const snap = await db.collection('config').doc('admin').get();
    const pinActual = snap.exists && snap.data().pin ? snap.data().pin : '1234';

    if (actual !== pinActual) {
      showToast('El PIN actual es incorrecto', 'error');
      return;
    }

    await db.collection('config').doc('admin').set({ pin: nuevo });
    cerrarCambiarPin();
    showToast('PIN cambiado correctamente', 'exito');
  } catch (err) {
    console.error(err);
    showToast('Error al cambiar el PIN', 'error');
  } finally {
    ocultarSpinner();
  }
}

// ── Cerrar sesión ──────────────────────────────────────────────────────────

function cerrarSesion() {
  sessionStorage.removeItem('adminOk');
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('pinScreen').style.display = 'flex';
  pinIngresado = '';
  actualizarPuntos();
}

// ── Utilidades UI ──────────────────────────────────────────────────────────

function showToast(msg, tipo = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function mostrarSpinner() { document.getElementById('spinnerOverlay').style.display = 'flex'; }
function ocultarSpinner() { document.getElementById('spinnerOverlay').style.display = 'none'; }

// ── Arrancar ───────────────────────────────────────────────────────────────

function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (sessionStorage.getItem('adminOk') === '1') {
    mostrarPanelAdmin();
  } else {
    document.getElementById('pinScreen').style.display = 'flex';
    initPinPad();
  }
}

init();
