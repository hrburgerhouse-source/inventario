// ── Estado global ──────────────────────────────────────────────────────────
let diaId = '';          // "YYYY-MM-DD" en zona El Salvador
let diaData = null;      // datos del turno activo
let productos = [];      // productos activos ordenados
let entradaProdId = null; // producto seleccionado para entrada
let turnoActual = 1;     // 1 o 2

// ── Zona horaria ───────────────────────────────────────────────────────────

function getFechaHoy() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function formatearFecha(fecha) {
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

// ── Login de empleado ──────────────────────────────────────────────────────

function mostrarLoginEmpleado() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('modalLogin').style.display = 'flex';
  setTimeout(() => document.getElementById('inputNombreEmpleado').focus(), 80);
}

function mostrarNombreEmpleado(nombre) {
  document.getElementById('empleadoNombre').textContent = nombre;
  document.getElementById('empleadoDisplay').style.display = 'flex';
}

async function loginEmpleado() {
  const nombre = document.getElementById('inputNombreEmpleado').value.trim();
  if (!nombre) { showToast('Ingresa tu nombre', 'error'); return; }
  localStorage.setItem('empleadoNombre', nombre);
  document.getElementById('modalLogin').style.display = 'none';
  mostrarNombreEmpleado(nombre);
  if (!diaData) {
    document.getElementById('loadingState').style.display = 'block';
    await cargarInventario();
  }
}

function cambiarEmpleado() {
  if (!confirm('¿Cambiar de empleado?')) return;
  localStorage.removeItem('empleadoNombre');
  diaData = null;
  document.getElementById('empleadoDisplay').style.display = 'none';
  document.getElementById('productosLista').style.display = 'none';
  document.getElementById('btnCerrarDia').style.display = 'none';
  document.getElementById('bannerCerrado').style.display = 'none';
  document.getElementById('inputNombreEmpleado').value = '';
  mostrarLoginEmpleado();
}

// ── Inicialización ─────────────────────────────────────────────────────────

async function init() {
  diaId = getFechaHoy();
  document.getElementById('fechaDisplay').textContent = formatearFecha(diaId);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const nombre = localStorage.getItem('empleadoNombre');
  if (!nombre) {
    mostrarLoginEmpleado();
    return;
  }

  mostrarNombreEmpleado(nombre);
  await cargarInventario();
}

async function cargarInventario() {
  try {
    const snap = await db.collection('productos').where('activo', '==', true).get();
    productos = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.orden || 999) - (b.orden || 999) || a.nombre.localeCompare(b.nombre));

    if (productos.length === 0) {
      mostrarVacio();
      return;
    }

    await initDia();
    renderUI();
  } catch (err) {
    console.error('Error al inicializar:', err);
    document.getElementById('loadingState').innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>Error de conexión.<br>Verifica la configuración de Firebase en <strong>js/config.js</strong>.</p>
      </div>`;
  }
}

// ── Inicializar / crear documento del día ──────────────────────────────────

async function initDia() {
  const ref = db.collection('dias').doc(diaId);
  const snap = await ref.get();

  if (snap.exists) {
    const doc = snap.data();

    if (doc.estado !== 'cerrado') {
      // ── Turno 1 abierto ──
      turnoActual = 1;
      diaData = doc;
      if (!diaData.items) diaData.items = {};

      // Arrastrar inicial del día anterior para productos sin inicial establecido
      const algunosSinInicial = productos.some(p => {
        const item = diaData.items[p.id];
        return !item || !(parseFloat(item.inicial) > 0);
      });
      if (algunosSinInicial) {
        const hist = await db.collection('dias').orderBy('fecha', 'desc').limit(30).get();
        for (const d of hist.docs) {
          const dd = d.data();
          if (!dd.fecha || dd.fecha >= diaId) continue;
          const t2items = dd.turno2?.items;
          const prevItems = (t2items && Object.keys(t2items).length > 0)
            ? t2items
            : (dd.items || {});
          if (Object.keys(prevItems).length === 0) continue;
          const updates = {};
          for (const p of productos) {
            const item = diaData.items[p.id];
            if (item && parseFloat(item.inicial) > 0) continue; // ya tiene inicial
            const prev = prevItems[p.id];
            const restantePrev = prev
              ? parseFloat(prev.inicial||0) + parseFloat(prev.entradas||0) - parseFloat(prev.usado||0)
              : 0;
            const inicial = Math.max(0, restantePrev);
            if (inicial <= 0) continue; // carry-over también da 0, no tocar
            const entradas = parseFloat(item?.entradas || 0);
            const usado = parseFloat(item?.usado || 0);
            updates[`items.${p.id}.inicial`] = inicial;
            updates[`items.${p.id}.restante`] = inicial + entradas - usado;
            if (!diaData.items[p.id]) diaData.items[p.id] = { entradas: 0, usado: 0 };
            diaData.items[p.id] = { ...diaData.items[p.id], inicial, restante: inicial + entradas - usado };
          }
          if (Object.keys(updates).length > 0) await ref.update(updates);
          break;
        }
      }

    } else if (!doc.turno2) {
      // ── Turno 1 cerrado → iniciar turno 2 automáticamente ──
      turnoActual = 2;
      const items = {};
      for (const p of productos) {
        const prev = doc.items?.[p.id];
        const restantePrev = prev
          ? parseFloat(prev.inicial||0) + parseFloat(prev.entradas||0) - parseFloat(prev.usado||0)
          : 0;
        const inicial = Math.max(0, restantePrev);
        items[p.id] = { inicial, entradas: 0, usado: 0, restante: inicial };
      }
      const t2 = {
        estado: 'abierto',
        items,
        creadoAt: firebase.firestore.FieldValue.serverTimestamp(),
        cerradoAt: null,
        cerradoPor: null
      };
      await ref.update({ turno2: t2, turnoActual: 2 });
      diaData = { estado: 'abierto', items, creadoAt: null, cerradoAt: null, cerradoPor: null };

    } else if (doc.turno2.estado !== 'cerrado') {
      // ── Turno 2 abierto ──
      turnoActual = 2;
      diaData = doc.turno2;
      if (!diaData.items) diaData.items = {};

    } else {
      // ── Ambos turnos cerrados ──
      turnoActual = 2;
      diaData = doc.turno2;
      if (!diaData.items) diaData.items = {};
    }

    // Agregar productos nuevos que no existan en el turno activo
    let nuevosProductos = false;
    for (const p of productos) {
      if (!diaData.items[p.id]) {
        diaData.items[p.id] = { inicial: 0, entradas: 0, usado: 0, restante: 0 };
        nuevosProductos = true;
      }
    }
    if (nuevosProductos && diaData.estado === 'abierto') {
      if (turnoActual === 1) {
        await ref.update({ items: diaData.items });
      } else {
        await ref.update({ 'turno2.items': diaData.items });
      }
    }
    return;
  }

  // ── Día nuevo: crear turno 1 con carry over ──
  turnoActual = 1;
  const historial = await db.collection('dias').orderBy('fecha', 'desc').limit(30).get();

  let ultimoItems = {};
  for (const doc of historial.docs) {
    const d = doc.data();
    if (!d.fecha || d.fecha >= diaId) continue;
    const t2items = d.turno2?.items;
    const candidate = (t2items && Object.keys(t2items).length > 0)
      ? t2items
      : (d.items || {});
    if (Object.keys(candidate).length > 0) {
      ultimoItems = candidate;
      break;
    }
  }

  const items = {};
  for (const p of productos) {
    const prev = ultimoItems[p.id];
    const restantePrev = prev
      ? parseFloat(prev.inicial || 0) + parseFloat(prev.entradas || 0) - parseFloat(prev.usado || 0)
      : 0;
    const inicial = Math.max(0, restantePrev);
    items[p.id] = { inicial, entradas: 0, usado: 0, restante: inicial };
  }

  const docNuevo = {
    fecha: diaId,
    estado: 'abierto',
    turnoActual: 1,
    creadoAt: firebase.firestore.FieldValue.serverTimestamp(),
    cerradoAt: null,
    cerradoPor: null,
    items
  };

  await ref.set(docNuevo);
  diaData = { ...docNuevo, items };
}

// ── Renderizado principal ──────────────────────────────────────────────────

function renderUI() {
  document.getElementById('loadingState').style.display = 'none';
  const cerrado = diaData.estado === 'cerrado';

  // Indicador de turno en header
  const turnoChip = document.getElementById('turnoChip');
  if (turnoChip) turnoChip.textContent = `· Turno ${turnoActual}`;

  // Banner de cerrado
  const banner = document.getElementById('bannerCerrado');
  if (cerrado) {
    let hora = '';
    if (diaData.cerradoAt?.seconds) {
      hora = new Date(diaData.cerradoAt.seconds * 1000)
        .toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
    }
    document.getElementById('cierreHora').textContent =
      `Turno ${turnoActual} cerrado a las ${hora || '—'}${diaData.cerradoPor ? ' por ' + diaData.cerradoPor : ''}`;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }

  renderProductos();

  const btn = document.getElementById('btnCerrarDia');
  btn.style.display = cerrado ? 'none' : 'block';
  btn.textContent = `✓ Cerrar turno ${turnoActual}`;
  btn.disabled = false;
}

function renderProductos() {
  const lista = document.getElementById('productosLista');
  const cerrado = diaData.estado === 'cerrado';

  lista.style.display = 'block';
  lista.innerHTML = productos.map(p => {
    const item = diaData.items[p.id] || { inicial: 0, entradas: 0, usado: 0, restante: 0 };
    const restante = parseFloat(item.inicial) + parseFloat(item.entradas) - parseFloat(item.usado);
    const esNeg = restante < 0;
    const esBajo = p.stockMinimo > 0 && restante < p.stockMinimo && restante >= p.stockMinimo * 0.5;
    const esCritico = p.stockMinimo > 0 && restante < p.stockMinimo * 0.5;

    const claseItem = esCritico ? 'producto-item stock-critico'
      : esBajo ? 'producto-item stock-bajo'
      : 'producto-item';

    return `
      <div class="${claseItem}" id="item-${p.id}">
        <div class="producto-header">
          <div>
            <div class="producto-nombre">${p.nombre}</div>
            <div class="producto-cat">${p.categoria}</div>
          </div>
          <span class="badge-unidad">${p.unidad}</span>
        </div>

        <div class="cantidades-grid">
          <div class="cant-box">
            <div class="cant-label">Inicial</div>
            <div class="cant-valor">${formatNum(item.inicial)}</div>
          </div>
          <div class="cant-box">
            <div class="cant-label">Entradas</div>
            <div class="cant-valor entrada-color" id="entradas-${p.id}">
              ${parseFloat(item.entradas) > 0 ? '+' + formatNum(item.entradas) : '—'}
            </div>
          </div>
          <div class="cant-box">
            <div class="cant-label">Restante</div>
            <div class="cant-valor ${esNeg ? 'negativo' : ''}" id="restante-${p.id}">
              ${formatNum(restante)}
            </div>
          </div>
        </div>

        ${!cerrado ? `
          <div class="usado-section">
            <span class="usado-label">Usado:</span>
            <input
              type="number"
              class="usado-input"
              id="usado-${p.id}"
              value="${parseFloat(item.usado) > 0 ? item.usado : ''}"
              placeholder="0"
              min="0"
              step="0.01"
              inputmode="decimal"
              oninput="actualizarRestante('${p.id}')"
            >
            <button class="btn-entrada" onclick="abrirEntrada('${p.id}', '${p.nombre.replace(/'/g, "\\'")}')">+ Entrada</button>
          </div>
        ` : `
          <div class="resumen-fila">
            <span>Usado: <strong>${formatNum(item.usado)}</strong> ${p.unidad}</span>
            <span style="${esNeg ? 'color:var(--peligro);font-weight:700;' : ''}">
              Restante: <strong>${formatNum(restante)}</strong>
            </span>
          </div>
        `}
      </div>
    `;
  }).join('');
}

// ── Calcular restante en vivo ──────────────────────────────────────────────

function actualizarRestante(productoId) {
  const item = diaData.items[productoId] || { inicial: 0, entradas: 0 };
  const usadoInput = document.getElementById(`usado-${productoId}`);
  const usado = parseFloat(usadoInput?.value) || 0;
  const restante = parseFloat(item.inicial) + parseFloat(item.entradas) - usado;

  const el = document.getElementById(`restante-${productoId}`);
  if (el) {
    el.textContent = formatNum(restante);
    el.className = `cant-valor ${restante < 0 ? 'negativo' : ''}`;
  }
}

// ── Modal de Entrada ───────────────────────────────────────────────────────

function abrirEntrada(productoId, nombre) {
  entradaProdId = productoId;
  document.getElementById('modalEntradaNombre').textContent = nombre;
  document.getElementById('entradaCantidad').value = '';
  document.getElementById('modalEntrada').style.display = 'flex';
  setTimeout(() => document.getElementById('entradaCantidad').focus(), 80);
}

function cerrarModalEntrada() {
  document.getElementById('modalEntrada').style.display = 'none';
  entradaProdId = null;
}

async function guardarEntrada() {
  const cantidad = parseFloat(document.getElementById('entradaCantidad').value);
  if (isNaN(cantidad) || cantidad <= 0) {
    showToast('Ingresa una cantidad mayor a 0', 'error');
    return;
  }

  const prodId = entradaProdId;
  cerrarModalEntrada();
  mostrarSpinner();

  try {
    const item = diaData.items[prodId] || { inicial: 0, entradas: 0, usado: 0, restante: 0 };
    const nuevasEntradas = parseFloat(item.entradas || 0) + cantidad;
    const nuevoRestante = parseFloat(item.inicial) + nuevasEntradas - parseFloat(item.usado || 0);

    const prefix = turnoActual === 1 ? 'items' : 'turno2.items';
    const update = {};
    update[`${prefix}.${prodId}.entradas`] = nuevasEntradas;
    update[`${prefix}.${prodId}.restante`] = nuevoRestante;

    await db.collection('dias').doc(diaId).update(update);

    // Actualizar estado local
    diaData.items[prodId] = { ...item, entradas: nuevasEntradas, restante: nuevoRestante };

    // Actualizar UI del producto
    const elEntradas = document.getElementById(`entradas-${prodId}`);
    if (elEntradas) elEntradas.textContent = `+${formatNum(nuevasEntradas)}`;
    actualizarRestante(prodId);

    const p = productos.find(x => x.id === prodId);
    showToast(`Entrada guardada: +${formatNum(cantidad)} ${p?.unidad || ''}`, 'exito');
  } catch (err) {
    console.error('Error al guardar entrada:', err);
    showToast('Error al guardar la entrada', 'error');
  } finally {
    ocultarSpinner();
  }
}

// ── Cerrar día ─────────────────────────────────────────────────────────────

async function cerrarDia() {
  const btn = document.getElementById('btnCerrarDia');

  // Recopilar todos los valores
  const items = {};
  let hayNegativos = false;
  let hayDatos = false;

  for (const p of productos) {
    const item = diaData.items[p.id] || { inicial: 0, entradas: 0 };
    const usadoInput = document.getElementById(`usado-${p.id}`);
    const usado = parseFloat(usadoInput?.value) || 0;
    const restante = parseFloat(item.inicial) + parseFloat(item.entradas) - usado;

    if (usado > 0) hayDatos = true;
    if (restante < 0) hayNegativos = true;

    items[p.id] = {
      inicial: parseFloat(item.inicial) || 0,
      entradas: parseFloat(item.entradas) || 0,
      usado,
      restante
    };
  }

  if (hayNegativos) {
    const ok = confirm(
      '⚠️ Algunos productos tienen restante negativo.\n¿Deseas cerrar el día de todas formas?'
    );
    if (!ok) return;
  }

  mostrarSpinner();
  btn.disabled = true;

  const nombre = localStorage.getItem('empleadoNombre') || 'empleado';

  try {
    if (turnoActual === 1) {
      await db.collection('dias').doc(diaId).update({
        items,
        estado: 'cerrado',
        cerradoAt: firebase.firestore.FieldValue.serverTimestamp(),
        cerradoPor: nombre
      });
    } else {
      await db.collection('dias').doc(diaId).update({
        'turno2.items': items,
        'turno2.estado': 'cerrado',
        'turno2.cerradoAt': firebase.firestore.FieldValue.serverTimestamp(),
        'turno2.cerradoPor': nombre
      });
    }

    diaData.items = items;
    diaData.estado = 'cerrado';
    diaData.cerradoAt = { seconds: Date.now() / 1000 };
    diaData.cerradoPor = nombre;

    showToast(`¡Turno ${turnoActual} cerrado correctamente!`, 'exito');
    renderUI();
  } catch (err) {
    console.error('Error al cerrar día:', err);
    showToast('Error al cerrar el día. Intenta de nuevo.', 'error');
    btn.disabled = false;
  } finally {
    ocultarSpinner();
  }
}

// ── Estado vacío ───────────────────────────────────────────────────────────

function mostrarVacio() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
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

function mostrarSpinner() {
  document.getElementById('spinnerOverlay').style.display = 'flex';
}
function ocultarSpinner() {
  document.getElementById('spinnerOverlay').style.display = 'none';
}

// ── Eventos ────────────────────────────────────────────────────────────────

document.getElementById('btnIniciarTurno').addEventListener('click', loginEmpleado);
document.getElementById('inputNombreEmpleado').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') loginEmpleado();
});

document.getElementById('btnCerrarDia').addEventListener('click', cerrarDia);
document.getElementById('btnGuardarEntrada').addEventListener('click', guardarEntrada);
document.getElementById('btnCancelarEntrada').addEventListener('click', cerrarModalEntrada);

// Cerrar modal al tocar el fondo
document.getElementById('modalEntrada').addEventListener('click', function (e) {
  if (e.target === this) cerrarModalEntrada();
});

// Enter en el input de entrada
document.getElementById('entradaCantidad').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') guardarEntrada();
});

// ── Arrancar ───────────────────────────────────────────────────────────────
init();
