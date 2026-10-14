# Lab 09 – Cloud Storage (S3) · Harold Santivañez

Galería de imágenes sobre Amazon S3 con **presigned URLs**. El bucket es privado y el navegador nunca recibe credenciales de AWS.

> **Nombre del bucket usado en todo el lab:** `lab-09-santivanez-20261014`
> (la guía mezcla `lab-09-…` y `lab-imagenes-…`; usa **un solo nombre** en todos los pasos. Si ya está tomado, agrega un sufijo, p. ej. `lab-09-santivanez-20261014-hs`, y reemplázalo en todo).

---

## Ejercicio 1 – Fundamentos de S3

### Parte A (consola) – tomar captura de cada paso
1. Consola AWS → **S3** → **Create bucket**.
2. Name: `lab-09-santivanez-20261014` · Region: **us-east-1**.
3. **Block all public access: ACTIVADO** (no tocar).
4. Create bucket → entrar al bucket → **Create folder**: `originales/`, `miniaturas/`, `temporal/`.
5. Entrar a `originales/` → **Upload** → 3 imágenes JPG/PNG (< 5 MB).

### Parte B (CLI, PowerShell)
```powershell
aws configure            # Access key, Secret, region us-east-1, output json
aws s3 ls
aws s3 ls s3://lab-09-santivanez-20261014/originales/
aws s3 cp .\mi-foto.jpg s3://lab-09-santivanez-20261014/originales/
aws s3 cp s3://lab-09-santivanez-20261014/originales/mi-foto.jpg .\descarga.jpg
aws s3 sync .\fotos\ s3://lab-09-santivanez-20261014/originales/
```
Captura extra para la pregunta 3: abre la **Object URL** de una imagen en el navegador → verás `AccessDenied` (XML).

> Si usas **AWS Academy / Learner Lab**: copia las credenciales de *AWS Details → AWS CLI* a `C:\Users\<tu-usuario>\.aws\credentials` (incluye `aws_session_token`). En Learner Lab **no se pueden crear usuarios IAM** → para el Ej. 2 Parte A documenta la política y usa el rol `LabRole`; avisa al docente.

---

## Ejercicio 2 – Seguridad, IAM y Cifrado

### Parte A – Usuario IAM
1. IAM → Users → **Create user** → `app-imagenes-user` → **sin** acceso a consola.
2. Permissions → **Attach policies directly** → **Create policy** → JSON → pegar `politicas/iam-policy.json` → nombre `PoliticaLabImagenes` → adjuntarla al usuario.
3. Usuario → Security credentials → **Create access key** → *Application running outside AWS* → guarda el `.csv` (NO subirlo a Git ni mostrarlo en capturas: tapa el secret).

### Parte B – Forzar HTTPS
Bucket → **Permissions → Bucket policy → Edit** → pegar `politicas/bucket-policy-https.json` → Save.

### Parte C – Cifrado en reposo
Bucket → **Properties → Default encryption → Edit** → **SSE-S3** → Save.
Sube un archivo nuevo → abre el objeto → Properties → *Server-side encryption: Amazon S3 managed keys (SSE-S3)* / AES-256.

### Parte D – Validación
```powershell
aws configure --profile app-user     # claves de app-imagenes-user, us-east-1
aws s3 ls s3://lab-09-santivanez-20261014/ --profile app-user                      # OK
aws s3 cp .\test.jpg s3://lab-09-santivanez-20261014/originales/ --profile app-user # OK
aws s3api delete-bucket --bucket lab-09-santivanez-20261014 --profile app-user      # AccessDenied (esperado)
```
Prueba opcional de HTTPS (debe fallar con AccessDenied):
```powershell
aws s3 ls s3://lab-09-santivanez-20261014/ --endpoint-url http://s3.amazonaws.com --profile app-user
```

---

## Ejercicio 3 – Versionado y Ciclo de Vida

### Parte A – Versionado
1. Properties → **Bucket Versioning → Enable**.
2. Sube `prueba.jpg` 3 veces (edítala un poco entre cargas, p. ej. con Paint).
3. Activa **Show versions** → 3 versiones.
4. Desactiva Show versions → elimina `prueba.jpg` → activa Show versions → aparece el **Delete marker**.
5. Selecciona el delete marker → Delete → el objeto vuelve.

### Parte B – Lifecycle
Management → **Create lifecycle rule**:
- Name: `regla-imagenes-antiguas` · Scope: *Limit the scope* → Prefix `originales/`
- Marcar: Transition current versions, Transition noncurrent versions, Permanently delete noncurrent versions, Delete expired object delete markers.
- Current: **Standard-IA a 30 días**, **Glacier Instant Retrieval a 90 días**
- Noncurrent: **Glacier Deep Archive a 60 días**
- Permanently delete noncurrent: **365 días**
- (marca el checkbox de aviso de costos de transición) → Create rule.

Alternativa por CLI: `aws s3api put-bucket-lifecycle-configuration --bucket lab-09-santivanez-20261014 --lifecycle-configuration file://politicas/lifecycle.json`
> Nota: en la consola, "Delete expired object delete markers" no se puede combinar con "Expire current versions"; por eso no se marca esa última.

### Parte D (opcional) – CRR
Crear `lab-09-santivanez-20261014-backup` en **us-west-2** con versionado → en el bucket origen: Management → Replication rules → Create → destino el bucket backup → IAM role: *Create new role* → Save. Sube un archivo y verifica que aparece en el backup (*Replication status: COMPLETED*).

---

## Ejercicio 4 – Aplicación web

### Configurar CORS del bucket
Permissions → **Cross-origin resource sharing (CORS)** → Edit → pegar `politicas/cors.json`.

### Ejecutar
```powershell
cd backend
copy .env.example .env      # editar con las claves de app-imagenes-user
npm install
npm start
```
Abre **http://localhost:3000** (el backend también sirve el frontend).

### Estructura
```
backend/   server.js · package.json · .env.example · .gitignore
frontend/  index.html · app.js · styles.css
politicas/ iam-policy.json · bucket-policy-https.json · cors.json · lifecycle.json
```

### Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/upload-url` | `{filename, contentType, sizeBytes}` → presigned PUT (5 min). Re-valida tipo y tamaño. Rate limit 20/min por IP |
| GET | `/api/images` | Lista `originales/` con presigned GET (15 min) |
| DELETE | `/api/images/:key` | Elimina el objeto (solo claves dentro de `originales/`) |

### Pruebas obligatorias (grabar / capturar)
1. **JPG válido** → aparece en la galería.
2. **.pdf o .exe** → arrástralo: el frontend muestra *Bloqueado: Tipo no permitido*.
3. **10 MB al backend** (el frontend ya lo bloquea, así que se prueba directo contra la API):
   ```powershell
   curl.exe -X POST http://localhost:3000/api/upload-url -H "Content-Type: application/json" -d "{\"filename\":\"grande.jpg\",\"contentType\":\"image/jpeg\",\"sizeBytes\":10485760}"
   ```
   → `400 {"error":"Archivo demasiado grande (máx. 5 MB)"}`
4. **Expiración**: clic derecho en una imagen → copiar dirección → esperar 16 min → abrirla → `AccessDenied: Request has expired`.
5. **Sin credenciales**: F12 → Sources → `app.js` → Ctrl+F `AKIA` → 0 resultados.
6. **Red**: F12 → Network → subir imagen → verás `upload-url` (localhost:3000) y luego un **PUT a `lab-09-santivanez-20261014.s3.amazonaws.com`**.

### Limpieza final (documentar con capturas)
```powershell
aws s3 rm s3://lab-09-santivanez-20261014 --recursive
```
Con versionado activo, en la consola usa **Empty bucket** (borra también versiones y delete markers) → **Delete bucket**. Luego IAM → `app-imagenes-user` → desactivar y eliminar access key → eliminar usuario y política.
