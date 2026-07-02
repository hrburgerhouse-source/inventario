// ── Estado global ──────────────────────────────────────────────────────────
let pinIngresado = '';
let productos = [];
let diaHoyId = '';
let productoEditandoId = null;
let rolAdmin = 'admin'; // 'admin' | 'encargado'

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
    let pinAdmin = '1234';
    let pinEncargado = '';

    if (!snap.exists) {
      await db.collection('config').doc('admin').set({ pin: '1234' });
    } else {
      if (snap.data().pin) pinAdmin = snap.data().pin;
      if (snap.data().pinEncargado) pinEncargado = snap.data().pinEncargado;
    }

    if (pinIngresado === pinAdmin) {
      rolAdmin = 'admin';
      sessionStorage.setItem('adminOk', '1');
      sessionStorage.setItem('adminRol', 'admin');
      mostrarPanelAdmin();
    } else if (pinEncargado && pinIngresado === pinEncargado) {
      rolAdmin = 'encargado';
      sessionStorage.setItem('adminOk', '1');
      sessionStorage.setItem('adminRol', 'encargado');
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
  rolAdmin = sessionStorage.getItem('adminRol') || 'admin';

  // Ajustar UI según el rol
  const subtitulo = document.querySelector('.header .subtitulo');
  if (subtitulo) subtitulo.textContent = rolAdmin === 'encargado' ? 'Panel Encargado' : 'Panel de Administración';

  const tabAjustesBtn = document.querySelector('.nav-admin [data-tab="ajustes"]');
  if (tabAjustesBtn) tabAjustesBtn.style.display = rolAdmin === 'encargado' ? 'none' : '';

  // Insertar botón cerrar sesión en nav (funciona con cualquier versión del HTML)
  if (!document.getElementById('btnLogoutNav')) {
    const nav = document.querySelector('.nav-admin');
    if (nav) {
      const btn = document.createElement('button');
      btn.id = 'btnLogoutNav';
      btn.textContent = '🔒 Cerrar sesión';
      btn.onclick = cerrarSesion;
      btn.style.cssText = 'background:none;border:1px solid var(--borde);border-radius:8px;padding:6px 12px;font-size:0.78rem;color:var(--texto-muted);cursor:pointer;white-space:nowrap;margin-left:auto;';
      nav.appendChild(btn);
    }
  }

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
  else if (tab === 'ajustes') renderAjustes();
}

// ── Cargar productos ───────────────────────────────────────────────────────

async function cargarProductos() {
  const snap = await db.collection('productos').get();
  productos = snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (a.orden || 999) - (b.orden || 999) || a.nombre.localeCompare(b.nombre));
}

// ── TAB: Inventario actual ─────────────────────────────────────────────────

function buildFilasTurno(items, activos) {
  let filas = '';
  let alertas = 0;
  for (const p of activos) {
    const item = items?.[p.id] || { inicial: 0, entradas: 0, usado: 0 };
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
        <td>${esCritico ? `<span class="badge-stock badge-critico">⚠ Crítico</span>` : esBajo ? `<span class="badge-stock badge-bajo">↓ Bajo</span>` : `<span style="color:var(--exito);">✓</span>`}</td>
      </tr>`;
  }
  return { filas, alertas };
}

async function renderInventario() {
  // Insertar botón cerrar sesión en nav si no existe
  if (!document.getElementById('btnLogoutNav')) {
    const nav = document.querySelector('.nav-admin');
    if (nav) {
      const btn = document.createElement('button');
      btn.id = 'btnLogoutNav';
      btn.textContent = '🔒 Cerrar sesión';
      btn.onclick = cerrarSesion;
      btn.style.cssText = 'background:none;border:1px solid var(--borde);border-radius:8px;padding:6px 12px;font-size:0.78rem;color:var(--texto-muted);cursor:pointer;white-space:nowrap;margin-left:auto;';
      nav.appendChild(btn);
    }
  }

  const container = document.getElementById('tab-inventario');
  container.innerHTML = `<div class="skeleton" style="height:240px;"></div>`;

  try {
    const snap = await db.collection('dias').doc(diaHoyId).get();
    const doc = snap.exists ? snap.data() : null;
    const activos = productos.filter(p => p.activo);

    const t2 = doc?.turno2 || null;
    const estadoTexto = !doc ? 'Sin datos'
      : t2?.estado === 'cerrado' ? '✅ Jornada completa'
      : t2 ? `🟡 Turno 2 abierto (${t2.cerradoPor || ''})`
      : doc.estado === 'cerrado' ? '✅ Turno 1 cerrado'
      : '🟡 Turno 1 abierto';

    const puedeReabrir = doc && (t2?.estado === 'cerrado' || (!t2 && doc.estado === 'cerrado'));
    const turnoActivoEs2 = t2 && t2.estado !== 'cerrado';
    const turnoActivoEs1 = !t2 && doc?.estado !== 'cerrado';

    const { filas: filas1, alertas: alertas1 } = buildFilasTurno(doc?.items, activos);
    const { filas: filas2, alertas: alertas2 } = t2 ? buildFilasTurno(t2.items, activos) : { filas: '', alertas: 0 };
    const alertasTotal = alertas1 + alertas2;

    const tablaTurno = (titulo, filas, estado, cerradoPor) => `
      <div style="font-size:0.8rem;font-weight:700;color:var(--texto-muted);margin:14px 0 6px;">${titulo}
        <span style="font-weight:400;margin-left:6px;">${estado === 'cerrado' ? `✅ Cerrado${cerradoPor ? ' por ' + cerradoPor : ''}` : '🟡 Abierto'}</span>
      </div>
      <div class="tabla-wrapper">
        <table class="tabla">
          <thead><tr><th>Producto</th><th>Inicial</th><th>Entradas</th><th>Usado</th><th>Restante</th><th>Stock</th></tr></thead>
          <tbody>${filas || '<tr><td colspan="6" style="text-align:center;color:var(--texto-muted);">Sin datos</td></tr>'}</tbody>
        </table>
      </div>`;

    container.innerHTML = `
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:700;">${formatearFecha(diaHoyId)}</div>
            <div style="font-size:0.8rem;color:var(--texto-muted);">${estadoTexto}
              ${alertasTotal > 0 ? `· <span style="color:var(--alerta);">⚠ ${alertasTotal} alerta${alertasTotal > 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${(turnoActivoEs1 || turnoActivoEs2) ? `<button class="btn btn-sm btn-primario" onclick="abrirAjusteStock()">✏️ Ajuste de stock</button>` : ''}
            <button class="btn btn-sm btn-secundario" onclick="verSiguienteDia()">👁 Ver siguiente día</button>
            ${puedeReabrir ? `<button class="btn btn-sm btn-secundario" onclick="reabrirDia('${diaHoyId}')">Reabrir</button>` : ''}
          </div>
        </div>
      </div>
      ${activos.length === 0
        ? `<div class="empty-state"><div class="icon">📦</div><p>No hay productos activos.</p></div>`
        : tablaTurno('Turno 1', filas1, doc?.estado || 'abierto', doc?.cerradoPor)
          + (t2 ? tablaTurno('Turno 2', filas2, t2.estado, t2.cerradoPor) : '')
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
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="chip ${d.estado === 'cerrado' ? 'chip-exito' : 'chip-alerta'}">
              ${d.estado === 'cerrado' ? '✅ Cerrado' : '🟡 Abierto'}
            </span>
            ${rolAdmin === 'admin' ? `<button class="btn btn-sm btn-peligro" onclick="event.stopPropagation(); eliminarDia('${d.fecha}')">🗑</button>` : ''}
          </div>
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

    const buildTabla = (items) => {
      let filas = '';
      for (const [id, item] of Object.entries(items || {})) {
        const p = prodMap[id];
        const restante = parseFloat(item.inicial) + parseFloat(item.entradas) - parseFloat(item.usado);
        filas += `<tr>
          <td><div style="font-weight:600;">${p?.nombre || id}</div>${p ? `<div style="font-size:0.72rem;color:var(--texto-muted);">${p.unidad}</div>` : ''}</td>
          <td>${formatNum(item.inicial)}</td>
          <td style="color:var(--exito)">${parseFloat(item.entradas) > 0 ? '+' + formatNum(item.entradas) : '—'}</td>
          <td>${formatNum(item.usado)}</td>
          <td style="${restante < 0 ? 'color:var(--peligro);font-weight:700;' : ''}">${formatNum(restante)}</td>
        </tr>`;
      }
      return `<div class="tabla-wrapper"><table class="tabla">
        <thead><tr><th>Producto</th><th>Inicial</th><th>Entradas</th><th>Usado</th><th>Restante</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" style="text-align:center;color:var(--texto-muted);">Sin items</td></tr>'}</tbody>
      </table></div>`;
    };

    const puedeReabrir = d.turno2?.estado === 'cerrado' || (!d.turno2 && d.estado === 'cerrado');

    cont.innerHTML = `
      ${volver}
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:700;font-size:1rem;">${formatearFecha(d.fecha)}</div>
            <div style="font-size:0.8rem;color:var(--texto-muted);">
              ${d.turno2?.estado === 'cerrado' ? '✅ Jornada completa' : d.estado === 'cerrado' ? '✅ Turno 1 cerrado' : '🟡 Abierto'}
            </div>
          </div>
          ${puedeReabrir ? `<button class="btn btn-sm btn-secundario" onclick="reabrirDia('${fecha}')">Reabrir</button>` : ''}
        </div>
      </div>
      <div style="font-size:0.8rem;font-weight:700;color:var(--texto-muted);margin-bottom:6px;">
        Turno 1 <span style="font-weight:400;">${d.estado === 'cerrado' ? `✅ Cerrado${d.cerradoPor ? ' por ' + d.cerradoPor : ''}` : '🟡 Abierto'}</span>
      </div>
      ${buildTabla(d.items)}
      ${d.turno2 ? `
        <div style="font-size:0.8rem;font-weight:700;color:var(--texto-muted);margin:14px 0 6px;">
          Turno 2 <span style="font-weight:400;">${d.turno2.estado === 'cerrado' ? `✅ Cerrado${d.turno2.cerradoPor ? ' por ' + d.turno2.cerradoPor : ''}` : '🟡 Abierto'}</span>
        </div>
        ${buildTabla(d.turno2.items)}
      ` : ''}
    `;
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<button class="btn btn-secundario btn-sm" onclick="cargarListaHistorial()" style="margin-bottom:14px;">← Historial</button>
      <div class="empty-state"><div class="icon">⚠️</div><p>Error al cargar los datos.</p></div>`;
  }
}

async function verSiguienteDia() {
  mostrarSpinner();
  try {
    const snap = await db.collection('dias').doc(diaHoyId).get();
    const diaData = snap.exists ? snap.data() : null;
    const activos = productos.filter(p => p.activo);
    const lastItems = diaData?.turno2?.items || diaData?.items || {};
    const jornadadCompleta = diaData?.turno2?.estado === 'cerrado';
    const t1Cerrado = diaData?.estado === 'cerrado';

    // Calcular la fecha de mañana en zona El Salvador
    const hoy = new Date(diaHoyId + 'T12:00:00');
    hoy.setDate(hoy.getDate() + 1);
    const manana = hoy.toISOString().slice(0, 10);

    let filas = '';
    let hayAlertas = false;

    for (const p of activos) {
      const item = lastItems[p.id] || { inicial: 0, entradas: 0, usado: 0 };
      const restanteHoy = parseFloat(item.inicial || 0) + parseFloat(item.entradas || 0) - parseFloat(item.usado || 0);
      const inicialManana = Math.max(0, restanteHoy);
      const esBajo = p.stockMinimo > 0 && inicialManana < p.stockMinimo;
      if (esBajo) hayAlertas = true;

      filas += `
        <tr>
          <td>
            <div style="font-weight:600;">${p.nombre}</div>
            <div style="font-size:0.72rem;color:var(--texto-muted);">${p.unidad}</div>
          </td>
          <td style="font-weight:700;font-size:1.05rem;${restanteHoy < 0 ? 'color:var(--peligro);' : ''}">${formatNum(inicialManana)}</td>
          <td>
            ${esBajo
              ? `<span class="badge-stock badge-${inicialManana <= p.stockMinimo * 0.5 ? 'critico' : 'bajo'}">⚠ ${inicialManana <= p.stockMinimo * 0.5 ? 'Crítico' : 'Bajo'}</span>`
              : `<span style="color:var(--exito);">✓</span>`}
          </td>
        </tr>
      `;
    }

    document.getElementById('siguienteDiaFecha').textContent = formatearFecha(manana);
    document.getElementById('siguienteDiaFuente').textContent =
      jornadadCompleta ? `Basado en el cierre del turno 2`
      : t1Cerrado ? `Basado en el cierre del turno 1 (turno 2 aún pendiente)`
      : `⚠️ Ningún turno cerrado aún — valores pueden cambiar`;
    document.getElementById('siguienteDiaFuenteColor').style.color =
      jornadadCompleta ? 'var(--exito)' : t1Cerrado ? 'var(--alerta)' : 'var(--peligro)';
    document.getElementById('siguienteDiaAlerta').style.display = hayAlertas ? 'block' : 'none';
    document.getElementById('siguienteDiaTabla').innerHTML = filas;
    document.getElementById('modalSiguienteDia').style.display = 'flex';
  } catch (err) {
    console.error(err);
    showToast('Error al calcular el siguiente día', 'error');
  } finally {
    ocultarSpinner();
  }
}

async function abrirAjusteStock() {
  mostrarSpinner();
  try {
    const snap = await db.collection('dias').doc(diaHoyId).get();
    const doc = snap.exists ? snap.data() : null;
    const activos = productos.filter(p => p.activo);

    if (activos.length === 0) {
      showToast('No hay productos activos en el catálogo', 'error');
      return;
    }

    // Ajustar el turno activo (turno2 si está abierto, sino turno1)
    const enTurno2 = doc?.turno2 && doc.turno2.estado !== 'cerrado';
    const activeItems = enTurno2 ? doc.turno2.items : doc?.items;

    const filas = activos.map(p => {
      const item = activeItems?.[p.id] || { inicial: 0, entradas: 0, usado: 0 };
      const disponible = parseFloat(item.inicial || 0) + parseFloat(item.entradas || 0) - parseFloat(item.usado || 0);
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--borde);">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.9rem;">${p.nombre}</div>
            <div style="font-size:0.72rem;color:var(--texto-muted);">${p.unidad}</div>
          </div>
          <input type="number" id="ajuste-${p.id}" value="${Math.max(0, disponible)}" min="0" step="0.01" inputmode="decimal"
            style="width:90px;padding:8px;border:2px solid var(--borde);border-radius:8px;font-size:1rem;font-weight:700;text-align:center;background:var(--bg);color:var(--texto);font-family:inherit;">
        </div>
      `;
    }).join('');

    document.getElementById('ajusteStockLista').innerHTML = filas;
    document.getElementById('modalAjusteStock').style.display = 'flex';
  } catch (err) {
    console.error(err);
    showToast('Error al cargar los datos', 'error');
  } finally {
    ocultarSpinner();
  }
}

function cerrarAjusteStock() {
  document.getElementById('modalAjusteStock').style.display = 'none';
}

async function guardarAjusteStock() {
  cerrarAjusteStock();
  mostrarSpinner();

  try {
    const snap = await db.collection('dias').doc(diaHoyId).get();
    const activos = productos.filter(p => p.activo);

    if (!snap.exists) {
      // Crear el documento del día desde cero
      const items = {};
      activos.forEach(p => {
        const val = parseFloat(document.getElementById(`ajuste-${p.id}`)?.value) || 0;
        // inicial = stock disponible, entradas = 0, restante = inicial - usado(0)
        items[p.id] = { inicial: val, entradas: 0, usado: 0, restante: val };
      });
      await db.collection('dias').doc(diaHoyId).set({
        fecha: diaHoyId,
        estado: 'abierto',
        creadoAt: firebase.firestore.FieldValue.serverTimestamp(),
        cerradoAt: null,
        cerradoPor: null,
        items
      });
    } else {
      const doc = snap.data();
      const enTurno2 = doc?.turno2 && doc.turno2.estado !== 'cerrado';
      const prefix = enTurno2 ? 'turno2.items' : 'items';
      const activeItems = enTurno2 ? doc.turno2.items : doc.items;
      const updates = {};
      activos.forEach(p => {
        const nuevoStock = parseFloat(document.getElementById(`ajuste-${p.id}`)?.value) || 0;
        const item = activeItems?.[p.id] || { usado: 0 };
        const usado = parseFloat(item.usado || 0);
        updates[`${prefix}.${p.id}.inicial`] = nuevoStock;
        updates[`${prefix}.${p.id}.entradas`] = 0;
        updates[`${prefix}.${p.id}.restante`] = nuevoStock - usado;
      });
      await db.collection('dias').doc(diaHoyId).update(updates);
    }

    showToast('Ajuste de stock guardado correctamente', 'exito');
    renderInventario();
  } catch (err) {
    console.error(err);
    showToast('Error al guardar el ajuste', 'error');
  } finally {
    ocultarSpinner();
  }
}

async function eliminarDia(fecha) {
  if (!confirm(`¿Eliminar el registro del ${formatearFecha(fecha)}?\n\nEsta acción no se puede deshacer.`)) return;
  mostrarSpinner();
  try {
    await db.collection('dias').doc(fecha).delete();
    showToast(`Día ${fecha} eliminado`, 'exito');
    cargarListaHistorial();
  } catch (err) {
    console.error(err);
    showToast('Error al eliminar el día', 'error');
  } finally {
    ocultarSpinner();
  }
}

async function reabrirDia(fecha) {
  if (!confirm(`¿Reabrir el día ${formatearFecha(fecha)}?\nEl empleado podrá modificar los datos.`)) return;
  mostrarSpinner();
  try {
    const snap = await db.collection('dias').doc(fecha).get();
    const doc = snap.exists ? snap.data() : null;

    let updates;
    if (doc?.turno2?.estado === 'cerrado') {
      updates = { 'turno2.estado': 'abierto', 'turno2.cerradoAt': null, 'turno2.cerradoPor': null };
    } else {
      updates = { estado: 'abierto', cerradoAt: null, cerradoPor: null };
    }

    await db.collection('dias').doc(fecha).update(updates);
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

    const filas = [['Fecha', 'Dia', 'Turno', 'Estado', 'Cerrado por', 'Producto', 'Categoria', 'Unidad', 'Inicial', 'Entradas', 'Usado', 'Restante']];

    snap.docs.forEach(doc => {
      const d = doc.data();
      const pushFilas = (items, turno, estado, cerradoPor) => {
        for (const [id, item] of Object.entries(items || {})) {
          const p = prodMap[id];
          const restante = parseFloat(item.inicial) + parseFloat(item.entradas) - parseFloat(item.usado);
          filas.push([
            d.fecha,
            formatearFecha(d.fecha),
            turno,
            estado,
            cerradoPor || '',
            p?.nombre || id,
            p?.categoria || '',
            p?.unidad || '',
            item.inicial,
            item.entradas,
            item.usado,
            restante
          ]);
        }
      };
      pushFilas(d.items, 'Turno 1', d.estado, d.cerradoPor);
      if (d.turno2) pushFilas(d.turno2.items, 'Turno 2', d.turno2.estado, d.turno2.cerradoPor);
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
      ${rolAdmin === 'admin' ? `<button class="btn btn-secundario btn-sm" onclick="importarCatalogo()">📥 Importar catálogo base</button>` : ''}
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
        ${rolAdmin === 'admin' ? `<button class="btn btn-sm btn-peligro" onclick="eliminarProducto('${p.id}', '${p.nombre.replace(/'/g, "\\'")}')">🗑</button>` : ''}
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

// ── TAB: Ajustes ───────────────────────────────────────────────────────────

function renderAjustes() {
  const container = document.getElementById('tab-ajustes');
  container.innerHTML = `
    <div style="padding:14px;">
      <div class="card" style="margin-bottom:12px;">
        <div style="font-weight:700;margin-bottom:12px;">🔒 PIN de administrador</div>
        <p style="font-size:0.82rem;color:var(--texto-muted);margin-bottom:12px;">
          El PIN por defecto es <strong>1234</strong>. Acceso completo al panel.
        </p>
        <button class="btn btn-primario btn-block" onclick="mostrarCambiarPin()">Cambiar PIN de administrador</button>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div style="font-weight:700;margin-bottom:12px;">🔑 PIN de encargado</div>
        <p style="font-size:0.82rem;color:var(--texto-muted);margin-bottom:12px;">
          Acceso limitado: puede ver inventario, reabrir turnos y gestionar catálogo, pero <strong>no puede eliminar</strong> datos ni cambiar PINs.
        </p>
        <button class="btn btn-secundario btn-block" onclick="mostrarCambiarPinEncargado()">Configurar PIN de encargado</button>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div style="font-weight:700;margin-bottom:12px;">👤 Sesión</div>
        <button class="btn btn-peligro btn-block" onclick="cerrarSesion()">Cerrar sesión</button>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:12px;">🔗 Navegación</div>
        <a href="index.html" class="btn btn-secundario btn-block" style="text-decoration:none;">
          ← Ir a vista de empleado
        </a>
      </div>
    </div>
  `;
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
  sessionStorage.removeItem('adminRol');
  rolAdmin = 'admin';
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('pinScreen').style.display = 'flex';
  pinIngresado = '';
  actualizarPuntos();
}

// ── PIN Encargado ──────────────────────────────────────────────────────────

function mostrarCambiarPinEncargado() {
  document.getElementById('inputPinEncargadoNuevo').value = '';
  document.getElementById('inputPinEncargadoConfirmar').value = '';
  document.getElementById('modalPinEncargado').style.display = 'flex';
}

function cerrarModalPinEncargado() {
  document.getElementById('modalPinEncargado').style.display = 'none';
}

async function guardarPinEncargado() {
  const nuevo = document.getElementById('inputPinEncargadoNuevo').value;
  const confirmar = document.getElementById('inputPinEncargadoConfirmar').value;

  if (!/^\d{4}$/.test(nuevo)) {
    showToast('El PIN debe tener exactamente 4 dígitos', 'error'); return;
  }
  if (nuevo !== confirmar) {
    showToast('Los PINs no coinciden', 'error'); return;
  }

  mostrarSpinner();
  try {
    await db.collection('config').doc('admin').set({ pinEncargado: nuevo }, { merge: true });
    cerrarModalPinEncargado();
    showToast('PIN de encargado guardado', 'exito');
  } catch (err) {
    console.error(err);
    showToast('Error al guardar el PIN', 'error');
  } finally {
    ocultarSpinner();
  }
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
    rolAdmin = sessionStorage.getItem('adminRol') || 'admin';
    mostrarPanelAdmin();
  } else {
    document.getElementById('pinScreen').style.display = 'flex';
    initPinPad();
  }
}

init();
