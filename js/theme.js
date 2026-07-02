// Modo oscuro — aplica al cargar y maneja el toggle
(function () {
  const guardado = localStorage.getItem('tema') || 'claro';
  document.documentElement.setAttribute('data-tema', guardado);

  window.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.textContent = guardado === 'oscuro' ? '☀️' : '🌙';

    btn.addEventListener('click', function () {
      const actual = document.documentElement.getAttribute('data-tema');
      const siguiente = actual === 'oscuro' ? 'claro' : 'oscuro';
      document.documentElement.setAttribute('data-tema', siguiente);
      localStorage.setItem('tema', siguiente);
      btn.textContent = siguiente === 'oscuro' ? '☀️' : '🌙';
    });
  });
})();
