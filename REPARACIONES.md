# Registro de Reparaciones — HR Burger House Inventario

## Problema principal: Inventario inicial siempre en cero al día siguiente

**Fecha de reparación:** 03 jul 2026  
**Archivos modificados:** `js/app.js`, `js/admin.js`, `admin.html`, `index.html`

---

### ¿Qué fallaba?

Al abrir el inventario cada día, todos los productos aparecían con **Inicial = 0**, sin importar lo que los empleados hubieran registrado el día anterior.

---

### Causas encontradas y lo que se corrigió

#### 1. El carry-over tomaba los datos de HOY como si fueran de AYER
**Archivo:** `js/app.js` — función `initDia()`

Cuando el documento de hoy ya existía en Firestore con ceros, la búsqueda del día anterior traía ese mismo documento (porque aparece primero en la consulta ordenada por fecha). Resultado: copiaba los ceros de hoy como si fueran el restante de ayer.

**Fix:** Se agregó un filtro `if (!dd.fecha || dd.fecha >= diaId) continue` para saltar el documento de hoy y cualquier fecha futura.

---

#### 2. El carry-over no corría si el empleado ya había registrado datos
**Archivo:** `js/app.js` — función `initDia()`

La condición anterior solo reparaba los iniciales si **todos** los campos (inicial, entradas Y usado) eran cero. Si el empleado ya había registrado aunque sea un valor de "usado", el carry-over se saltaba completo, dejando `inicial = 0` para siempre.

**Fix:** Se cambió la condición a `algunosSinInicial`: ahora el carry-over corre si cualquier producto tiene `inicial = 0`, sin importar si ya tiene datos de `usado` o `entradas`. Además, ya no borra los datos que el empleado registró — solo actualiza el `inicial` faltante y recalcula el `restante`.

---

#### 3. `turno2.items` vacío bloqueaba el carry-over
**Archivo:** `js/app.js` — función `initDia()`

Cuando existía un `turno2` creado automáticamente pero sin items reales `{}`, el sistema lo detectaba como válido (en JavaScript `{}` es "truthy") y lo usaba como fuente del carry-over, obteniendo ceros en lugar de leer el `turno1.items` que sí tenía datos.

**Fix:** Se verifica `Object.keys(t2items).length > 0` antes de usar `turno2.items`.

---

#### 4. El panel admin no podía reparar los iniciales manualmente
**Archivo:** `js/admin.js` — función `repararInicial()`

No existía ninguna herramienta en el panel admin para corregir los iniciales del día sin esperar a que el empleado cargara la app del empleado.

**Fix:** Se agregó la función `repararInicial()` que:
- Lee el día anterior más reciente con datos reales
- Actualiza solo los productos con `inicial = 0` (no toca `usado` ni `entradas`)
- Si los restantes del día anterior también son 0, muestra aviso para usar "Ajuste de stock"

---

#### 5. El panel admin se auto-repara al abrir
**Archivo:** `js/admin.js` — función `renderInventario()`

Al cargar el tab **Inventario**, si detecta que todos los iniciales del turno activo están en 0, llama `repararInicial()` automáticamente en silencio.

---

#### 6. `guardarAjusteStock()` creaba documentos incompletos
**Archivo:** `js/admin.js`

Al crear el documento del día desde el panel admin (cuando todavía no existía), faltaba el campo `turnoActual: 1`, lo que causaba inconsistencias al detectar qué turno estaba activo.

**Fix:** Se agregó `turnoActual: 1` al crear el documento.

---

#### 7. Versiones de JS desactualizadas en el HTML
**Archivos:** `index.html`, `admin.html`

Los archivos HTML apuntaban a versiones muy viejas de los scripts (`?v=3`), por lo que el navegador cargaba código antiguo con todos los bugs anteriores.

**Fix:** Se actualizaron los parámetros de versión en todos los `<script src="...">`.

---

#### 8. HTML cacheado en el navegador
**Archivo:** `admin.html`

El navegador guardaba en caché el `admin.html` y servía la versión vieja aunque el código en el servidor ya estuviera actualizado. Esto hacía que correcciones nuevas no aparecieran.

**Fix:** Se agregaron meta tags de no-caché al `<head>` de `admin.html`:
```html
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
```

---

### Si vuelve a fallar — lista de verificación

1. **¿Los iniciales están en 0?** → Abrir panel admin → tab Inventario → esperar 3 segundos (se repara solo). Si no, usar botón **"✏️ Ajuste de stock"**.
2. **¿El empleado ve datos viejos o el admin no ve cambios?** → Hacer `Ctrl + Shift + R` en el navegador para forzar recarga sin caché.
3. **¿Aparece error "failed-precondition" en consola?** → Asegurarse de que `js/config.js` NO tenga `db.enablePersistence(...)`. Esa línea fue eliminada porque causa conflictos cuando admin.html e index.html están abiertos al mismo tiempo.
4. **¿El carry-over da 0 para todos los productos?** → Significa que el día anterior también terminó con `restante = 0` para todo. Esto pasa cuando nunca se estableció un stock inicial. Solución: el admin usa **"✏️ Ajuste de stock"** para ingresar las cantidades físicas reales una vez, y de ahí en adelante el carry-over funciona correctamente.
