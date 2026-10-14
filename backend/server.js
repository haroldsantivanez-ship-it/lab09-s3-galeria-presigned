require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const PORT = process.env.PORT || 3000;
const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION || 'us-east-1';
const PREFIX = 'originales/';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

if (!BUCKET) {
  console.error('Falta S3_BUCKET en el archivo .env');
  process.exit(1);
}

// El SDK toma las credenciales de las variables de entorno (.env),
// del perfil de ~/.aws o del IAM Role (EC2/ECS/Lambda). Nunca se envian al navegador.
const s3 = new S3Client({ region: REGION });

const app = express();
app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:8080'] }));
app.use(express.json({ limit: '10kb' }));

// Rate limiting: maximo 20 URLs de subida por minuto por IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un minuto' },
});

// Sirve el frontend desde el mismo servidor (http://localhost:3000)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Solo se permite operar sobre claves dentro de originales/ y sin path traversal
function isValidKey(key) {
  return typeof key === 'string' && key.startsWith(PREFIX) && !key.includes('..') && key.length < 512;
}

// 1) Presigned URL para SUBIR (valida 5 minutos)
app.post('/api/upload-url', uploadLimiter, async (req, res) => {
  try {
    const { filename, contentType, sizeBytes } = req.body || {};

    // Re-validacion en el backend (el frontend se puede saltar)
    if (typeof filename !== 'string' || !filename.trim()) {
      return res.status(400).json({ error: 'Nombre de archivo requerido' });
    }
    if (!ALLOWED_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido' });
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      return res.status(400).json({ error: 'Tamaño de archivo inválido' });
    }
    if (sizeBytes > MAX_SIZE_BYTES) {
      return res.status(400).json({ error: `Archivo demasiado grande (máx. ${MAX_SIZE_MB} MB)` });
    }

    // Nombre seguro y unico (evita ../ y caracteres raros)
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const key = `${PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;

    // ContentType queda firmado: si el navegador envia otro tipo, S3 rechaza la subida.
    // Se fuerza cifrado en reposo SSE-S3 (AES-256).
    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });

    res.json({ uploadUrl, key, expiresIn: 300 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar la URL de subida' });
  }
});

// 2) Listar imagenes con presigned URLs de visualizacion (validas 15 minutos)
app.get('/api/images', async (req, res) => {
  try {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
    const objects = (list.Contents || []).filter((o) => !o.Key.endsWith('/')); // ignora la "carpeta"

    const items = await Promise.all(
      objects.map(async (obj) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
          { expiresIn: 900 }
        );
        return { key: obj.Key, size: obj.Size, lastModified: obj.LastModified, url };
      })
    );

    items.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo listar el bucket' });
  }
});

// 3) Eliminar imagen
app.delete('/api/images/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    if (!isValidKey(key)) {
      return res.status(400).json({ error: 'Clave inválida' });
    }
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ deleted: true, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar la imagen' });
  }
});

app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT}`);
  console.log(`Bucket: ${BUCKET} (${REGION})`);
});
