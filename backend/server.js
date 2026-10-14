require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { S3Client, PutObjectCommand, GetObjectCommand,
        DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:8080'] }));
app.use(express.json({ limit: '10kb' }));

// El frontend se sirve desde el mismo backend (http://localhost:3000)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Credenciales: el SDK las lee de las variables de entorno (.env) o del IAM Role.
// En AWS Academy Learner Lab se requiere ademas AWS_SESSION_TOKEN.
const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET;
const PREFIX = 'originales/';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

// Magic bytes (firma binaria) de cada tipo permitido
const MAGIC = {
  'image/jpeg': b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png':  b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
  'image/webp': b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP'
};

// Rate limiting: maximo 20 URLs de subida por minuto por IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  message: { error: 'Demasiadas solicitudes, intente en un minuto' }
});

function isValidKey(key) {
  return typeof key === 'string' && key.startsWith(PREFIX) && !key.includes('..') && key.length < 512;
}

// 1) Generar presigned URL para subir (valida 5 minutos)
app.post('/api/upload-url', uploadLimiter, async (req, res, next) => {
  try {
    const { filename, contentType, sizeBytes } = req.body || {};

    if (typeof filename !== 'string' || !filename.trim()) {
      return res.status(400).json({ error: 'Nombre de archivo requerido' });
    }
    if (!ALLOWED_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido' });
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SIZE) {
      return res.status(400).json({ error: `Archivo demasiado grande (max ${MAX_SIZE_MB} MB)` });
    }

    // Generar nombre seguro y unico (evita ../ y caracteres maliciosos)
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const key = `${PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes, // se firma: S3 rechaza un cuerpo de otro tamano
      ServerSideEncryption: 'AES256'
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 300 });
    res.json({ uploadUrl: url, key });
  } catch (err) { next(err); }
});

// 1b) Verificacion posterior a la carga: magic bytes + tamano real
app.post('/api/confirm', async (req, res, next) => {
  try {
    const { key } = req.body || {};
    if (!isValidKey(key)) return res.status(400).json({ error: 'Key invalida' });

    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: 'bytes=0-15' }));
    const firstBytes = Buffer.from(await obj.Body.transformToByteArray());
    const check = MAGIC[head.ContentType];

    if (head.ContentLength > MAX_SIZE || !check || !check(firstBytes)) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      return res.status(400).json({ error: 'El contenido no es una imagen valida; se elimino' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// 2) Listar imagenes con presigned URLs de visualizacion (validas 15 minutos)
app.get('/api/images', async (req, res, next) => {
  try {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));

    const items = await Promise.all((list.Contents || [])
      .filter(obj => !obj.Key.endsWith('/'))
      .map(async obj => {
        const url = await getSignedUrl(s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
          { expiresIn: 900 }
        );
        return { key: obj.Key, size: obj.Size, lastModified: obj.LastModified, url };
      }));

    items.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    res.json(items);
  } catch (err) { next(err); }
});

// 3) Eliminar imagen (la key llega codificada con encodeURIComponent)
app.delete('/api/images/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!isValidKey(key)) return res.status(400).json({ error: 'Key invalida' });

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// Manejo de errores: no exponer detalles internos al cliente
app.use((err, req, res, next) => {
  console.error(err.name, err.message);
  res.status(500).json({ error: 'Error interno', code: err.name });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
