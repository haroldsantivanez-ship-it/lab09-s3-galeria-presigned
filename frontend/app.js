// IMPORTANTE: este archivo NO contiene credenciales de AWS.
// Solo conoce la URL del backend, que es quien firma las URLs.
const API = window.location.port === '3000' ? '' : 'http://localhost:3000';
const MAX_SIZE_MB = 5;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const fileInput = document.getElementById('file');
const dropzone = document.getElementById('dropzone');
const uploadBtn = document.getElementById('uploadBtn');
const fileNameEl = document.getElementById('fileName');
const statusEl = document.getElementById('status');
const gallery = document.getElementById('gallery');

let selectedFile = null;

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

// Validacion en el frontend
function validate(file) {
  if (!ALLOWED.includes(file.type)) return 'Tipo no permitido. Solo JPG, PNG o WEBP.';
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return `Archivo demasiado grande (máx. ${MAX_SIZE_MB} MB).`;
  return null;
}

function selectFile(file) {
  if (!file) return;
  const error = validate(file);
  if (error) {
    selectedFile = null;
    uploadBtn.disabled = true;
    fileNameEl.textContent = file.name;
    setStatus(`Bloqueado: ${error}`, 'error');
    return;
  }
  selectedFile = file;
  uploadBtn.disabled = false;
  fileNameEl.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  setStatus('Listo para subir', 'info');
}

fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));

// Drag and drop
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('over'); })
);
dropzone.addEventListener('drop', (e) => selectFile(e.dataTransfer.files[0]));

uploadBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  const file = selectedFile;
  uploadBtn.disabled = true;

  try {
    // 1) Pedir presigned URL al backend
    setStatus('Solicitando URL firmada al backend...');
    const res = await fetch(`${API}/api/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error del backend');

    // 2) PUT directo a S3 (el archivo NO pasa por el backend)
    setStatus('Subiendo directo a S3...');
    const put = await fetch(data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!put.ok) throw new Error(`S3 rechazó la subida (HTTP ${put.status})`);

    setStatus(`Subida completa: ${data.key}`, 'ok');
    selectedFile = null;
    fileInput.value = '';
    fileNameEl.textContent = 'Ningún archivo seleccionado';
    loadGallery();
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    uploadBtn.disabled = false;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadGallery() {
  try {
    const res = await fetch(`${API}/api/images`);
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || 'Error al listar');

    if (!items.length) {
      gallery.innerHTML = '<p class="empty">Aún no hay imágenes en originales/</p>';
      return;
    }

    gallery.innerHTML = items.map((i) => `
      <figure class="card">
        <a href="${escapeHtml(i.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(i.url)}" alt="" loading="lazy"></a>
        <figcaption>
          <span title="${escapeHtml(i.key)}">${escapeHtml(i.key.replace('originales/', ''))}</span>
          <small>${(i.size / 1024).toFixed(1)} KB · ${new Date(i.lastModified).toLocaleString()}</small>
          <button class="danger" data-key="${escapeHtml(i.key)}">Eliminar</button>
        </figcaption>
      </figure>`).join('');
  } catch (err) {
    gallery.innerHTML = `<p class="empty error">No se pudo cargar la galería: ${escapeHtml(err.message)}</p>`;
  }
}

gallery.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-key]');
  if (!btn) return;
  const key = btn.dataset.key;
  if (!confirm(`¿Eliminar ${key}?`)) return;
  const res = await fetch(`${API}/api/images/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (res.ok) setStatus(`Eliminada: ${key}`, 'ok');
  else setStatus('No se pudo eliminar', 'error');
  loadGallery();
});

document.getElementById('refreshBtn').addEventListener('click', loadGallery);

loadGallery();
