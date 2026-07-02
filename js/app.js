// ── Estado global ──────────────────────────────────────────────────────────
let diaId = '';          // "YYYY-MM-DD" en zona El Salvador
let diaData = null;      // documento Firestore del día
let productos = [];      // productos activos ordenados
let entradaProdId = null; // producto seleccionado para entrada

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

// ── Inicialización ─────────────────────────────────────────────────────────

async function init() {
  diaId = getFechaHoy();
  document.getElementById('fechaDisplay').textContent = formatearFecha(diaId);

  // Registrar service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  try {
    // Cargar productos activos (sin orderBy para evitar requerir índice compuesto)
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
    diaData = snap.data();
    if (!diaData.items) diaData.items = {};

    // Si el día está abierto y todos los items tienen inicial=0, entradas=0, usado=0
    // intentar arrastrar el restante del día anterior (por si el doc se creó antes del fix)
    if (diaData.estado === 'abierto') {
      const todosEnCero = productos.every(p => {
        const item = diaData.items[p.id];
        return !item || (!item.inicial && !item.entradas && !item.usado);
      });

      if (todosEnCero) {
        const historial = await db.collection('dias')
          .orderBy('fecha', 'desc')
          .limit(30)
          .get();

        let encontrado = false;
        for (const doc of historial.docs) {
          const d = doc.data();
          if (d.fecha < diaId) {
            encontrado = true;
            const updates = {};
            let hayDatos = false;
            for (const p of productos) {
              const prev = d.items?.[p.id];
              const restantePrev = prev
                ? parseFloat(prev.inicial || 0) + parseFloat(prev.entradas || 0) - parseFloat(prev.usado || 0)
                : 0;
              const inicial = Math.max(0, restantePrev);
              if (inicial > 0) hayDatos = true;
              updates[`items.${p.id}.inicial`] = inicial;
              updates[`items.${p.id}.restante`] = inicial;
              diaData.items[p.id] = { inicial, entradas: 0, usado: 0, restante: inicial };
            }
            if (Object.keys(updates).length > 0) await ref.update(updates);
            if (hayDatos) {
              showToast(`Stock cargado del ${d.fecha}`, 'exito');
            } else {
              showToast('Día anterior encontrado pero sin stock registrado. Usa Ajuste de stock.', 'info');
            }
            break;
          }
        }
        if (!encontrado) {
          showToast('Sin días anteriores. Usa Ajuste de stock para ingresar el stock inicial.', 'info');
        }
      }
    }

    // Agregar productos nuevos que no existan en el doc
    let nuevosProductos = false;
    for (const p of productos) {
      if (!diaData.items[p.id]) {
        diaData.items[p.id] = { inicial: 0, entradas: 0, usado: 0, restante: 0 };
        nuevosProductos = true;
      }
    }
    if (nuevosProductos && diaData.estado === 'abierto') {
      await ref.update({ items: diaData.items });
    }
    return;
  }

  // El día no existe — buscar el día más reciente anterior para arrastrar restantes
  const historial = await db.collection('dias')
    .orderBy('fecha', 'desc')
    .limit(30)
    .get();

  let ultimoDia = null;
  let ultimoItems = {};
  for (const doc of historial.docs) {
    const d = doc.data();
    if (d.fecha < diaId) {
      ultimoDia = d.fecha;
      ultimoItems = d.items || {};
      break;
    }
  }

  // Construir items para el día nuevo
  const items = {};
  let hayDatos = false;
  for (const p of productos) {
    const prev = ultimoItems[p.id];
    const restantePrev = prev
      ? parseFloat(prev.inicial || 0) + parseFloat(prev.entradas || 0) - parseFloat(prev.usado || 0)
      : 0;
    const inicial = Math.max(0, restantePrev);
    if (inicial > 0) hayDatos = true;
    items[p.id] = { inicial, entradas: 0, usado: 0, restante: inicial };
  }

  const docNuevo = {
    fecha: diaId,
    estado: 'abierto',
    creadoAt: firebase.firestore.FieldValue.serverTimestamp(),
    cerradoAt: null,
    cerradoPor: null,
    items
  };

  await ref.set(docNuevo);
  diaData = { ...docNuevo, items };

  if (hayDatos) {
    showToast(`Stock cargado del ${ultimoDia}`, 'exito');
  } else if (ultimoDia) {
    showToast('Día anterior sin stock registrado. Usa Ajuste de stock.', 'info');
  } else {
    showToast('Primer día. Usa Ajuste de stock para ingresar el stock inicial.', 'info');
  }
}

// ── Renderizado principal ──────────────────────────────────────────────────

function renderUI() {
  document.getElementById('loadingState').style.display = 'none';
  const cerrado = diaData.estado === 'cerrado';

  // Banner de cerrado
  const banner = document.getElementById('bannerCerrado');
  if (cerrado) {
    let hora = '';
    if (diaData.cerradoAt?.seconds) {
      hora = new Date(diaData.cerradoAt.seconds * 1000)
        .toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
    }
    document.getElementById('cierreHora').textContent =
      `Cerrado a las ${hora || '—'}${diaData.cerradoPor ? ' por ' + diaData.cerradoPor : ''}`;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }

  renderProductos();

  document.getElementById('btnCerrarDia').style.display = cerrado ? 'none' : 'block';
  document.getElementById('btnCerrarDia').disabled = false;
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

    const update = {};
    update[`items.${prodId}.entradas`] = nuevasEntradas;
    update[`items.${prodId}.restante`] = nuevoRestante;

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

  try {
    await db.collection('dias').doc(diaId).update({
      items,
      estado: 'cerrado',
      cerradoAt: firebase.firestore.FieldValue.serverTimestamp(),
      cerradoPor: 'empleado'
    });

    diaData.items = items;
    diaData.estado = 'cerrado';
    diaData.cerradoAt = { seconds: Date.now() / 1000 };
    diaData.cerradoPor = 'empleado';

    showToast('¡Día cerrado correctamente!', 'exito');
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
