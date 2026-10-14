# Lab 09 – Cloud Storage (S3) · Galería de imágenes con presigned URLs

**Alumno:** Harold Eduardo Santivañez García · **Curso:** Desarrollo de Soluciones en la Nube
**Bucket:** `lab-imagenes-santivanez-20261014` (us-east-1)

Aplicación web que sube, lista, previsualiza y elimina imágenes en un bucket S3 **privado**.
El navegador nunca recibe credenciales de AWS: el backend solo emite URLs prefirmadas de corta duración
y el archivo viaja directamente del navegador a S3.

```
Navegador ──1) POST /api/upload-url──▶ Backend (Express + AWS SDK v3)
Navegador ◀─2) presigned URL (PUT, 5 min)── Backend
Navegador ──3) PUT imagen directo────────▶ Amazon S3 (privado, SSE-S3, HTTPS obligatorio)
Navegador ──4) POST /api/confirm─────────▶ Backend verifica magic bytes (si no es imagen, la borra)
```

## Estructura

```
backend/   server.js, package.json, .env.example (.env NO se sube a Git)
frontend/  index.html, app.js, styles.css   (servidos por el backend en http://localhost:3000)
aws/       iam-policy.json, bucket-policy.json, cors.json, cors-cli.json, lifecycle.json
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/upload-url` | Recibe `{filename, contentType, sizeBytes}`, re-valida tipo (jpeg/png/webp) y tamaño (< 5 MB) y devuelve una presigned URL PUT válida 5 min. El tamaño queda firmado (`Content-Length`). Rate limit: 20/min por IP. |
| POST | `/api/confirm` | Tras la subida, lee los primeros bytes del objeto y verifica la firma binaria (magic bytes). Si no coincide, elimina el objeto. |
| GET | `/api/images` | Lista `originales/` con presigned URLs GET válidas 15 min. |
| DELETE | `/api/images/:key` | Elimina la imagen (solo keys bajo `originales/`, sin `..`). |

## Ejecución

```bash
cd backend
npm install
cp .env.example .env     # pegar credenciales (Learner Lab: incluye AWS_SESSION_TOKEN)
npm start                # http://localhost:3000
```

> `npm start` usa `node --use-system-ca` para confiar en los certificados del sistema
> (necesario si un antivirus como Avast inspecciona HTTPS).

## Seguridad aplicada

- Bucket con *Block all public access*, cifrado SSE-S3 y política que niega tráfico sin HTTPS.
- Credenciales solo en `.env` (ignorado por Git) o, en EC2, mediante IAM Role (sin `.env`).
- Validación doble (frontend + backend), nombre de archivo sanitizado y prefijo aleatorio.
- Verificación de magic bytes después de la carga; tamaño firmado en la presigned URL.
- Rate limiting en el endpoint que genera URLs; CORS restringido a `localhost`.
- Errores internos no se exponen al cliente.
