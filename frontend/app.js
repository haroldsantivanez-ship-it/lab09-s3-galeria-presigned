// IMPORTANTE: este archivo NO contiene credenciales de AWS.
// Solo habla con el backend (para pedir URLs) y con S3 (usando URLs prefirmadas).
const API = window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000';
const MAX_SIZE_MB = 5;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const $ = id => document.getElementById(id);
const fileInput = $('file');
let selected = null;

function setStatus(msg, type = 'info') {
  $('status').textContent = msg;
  $('status').className = type;
}

function selectFile(file) {
  selected = null;
  $('uploadBtn').disabled = true;
  if (!file) return;

  // Validacion en frontend (el backend vuelve a validar)
  if (!ALLOWED.includes(file.type)) {
    $('filename').textContent = file.name;
    return setStatus(`Tipo no permitido (${file.type || 'desconocido'}). Solo JPG, PNG o WEBP.`, 'error');
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    $('filename').textContent = file.name;
    return setStatus(`Archivo demasiado grande (${(file.size / 1048576).toFixed(1)} MB). Maximo ${MAX_SIZE_MB} MB.`, 'error');
  }
  selected = file;
  $('filename').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
  $('uploadBtn').disabled = false;
  setStatus('');
}

// Drag and drop + input file
const dz = $('dropzone');
dz.addEventListener('click', () => fileInput.click());
dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));

$('uploadBtn').addEventListener('click', async () => {
  const file = selected;
  if (!file) return;
  $('uploadBtn').disabled = true;

  try {
    // 1) Pedir presigned URL al backend
    setStatus('Solicitando URL prefirmada...');
    const res = await fetch(`${API}/api/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al pedir URL');

    // 2) PUT directo a S3 (el archivo NO pasa por el backend)
    setStatus('Subiendo directamente a S3...');
    const put = await fetch(data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file
    });
    if (!put.ok) throw new Error(`S3 respondio ${put.status}`);

    // 3) El backend verifica el contenido real (magic bytes)
    const conf = await fetch(`${API}/api/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: data.key })
    });
    const confData = await conf.json();
    if (!conf.ok) throw new Error(confData.error);

    setStatus('Subida completa ✔', 'ok');
    selectFile(null);
    fileInput.value = '';
    $('filename').textContent = 'Ningun archivo seleccionado';
    loadGallery();
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    $('uploadBtn').disabled = !selected;
  }
});

async function loadGallery() {
  const gallery = $('gallery');
  try {
    const res = await fetch(`${API}/api/images`);
    const items = await res.json();
    if (!res.ok) throw new Error(items.code || items.error);

    gallery.innerHTML = '';
    if (!items.length) {
      gallery.innerHTML = '<p class="empty">No hay imagenes todavia.</p>';
      return;
    }
    for (const i of items) {
      const card = document.createElement('div');
      card.className = 'card';

      const img = document.createElement('img');
      img.src = i.url;
      img.alt = i.key;
      img.loading = 'lazy';

      const name = document.createElement('p');
      name.className = 'name';
      name.textContent = i.key.replace('originales/', '');
      name.title = i.key;

      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = `${(i.size / 1024).toFixed(0)} KB · ${new Date(i.lastModified).toLocaleString()}`;

      const row = document.createElement('div');
      row.className = 'row';
      const open = document.createElement('a');
      open.href = i.url;
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = 'Abrir';
      const btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = 'Eliminar';
      btn.addEventListener('click', () => del(i.key));
      row.append(open, btn);

      card.append(img, name, meta, row);
      gallery.append(card);
    }
  } catch (err) {
    gallery.innerHTML = '';
    setStatus(`No se pudo cargar la galeria: ${err.message}`, 'error');
  }
}

async function del(key) {
  if (!confirm(`¿Eliminar ${key}?`)) return;
  const res = await fetch(`${API}/api/images/${encodeURIComponent(key)}`, { method: 'DELETE' });
  setStatus(res.ok ? 'Imagen eliminada' : 'No se pudo eliminar', res.ok ? 'ok' : 'error');
  loadGallery();
}

$('refreshBtn').addEventListener('click', loadGallery);
loadGallery();
