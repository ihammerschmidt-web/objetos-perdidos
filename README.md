# 🎒 fiubaLost

App web instalable (PWA) para que la comunidad de FIUBA **publique y reclame objetos perdidos**.

- El **personal** publica los objetos que encuentra y dónde retirarlos.
- Los **alumnos** publican lo que perdieron (y dónde), y pueden reclamar objetos encontrados.
- Cualquiera puede **ver y buscar** el listado sin cuenta; para publicar o reclamar hace falta registrarse con un **mail @fi.uba.ar**.

Es una PWA: funciona en el navegador y se puede **instalar en el celular** como una app, sin pasar por tiendas.

## Cómo funciona

| Quién | Qué puede hacer |
|---|---|
| Visitante | Ver y buscar objetos encontrados y perdidos |
| Alumno (cuenta) | Publicar objetos perdidos, reclamar objetos encontrados, avisar que encontró algo perdido, ver el estado de sus reclamos |
| Personal | Todo lo anterior + publicar objetos encontrados, aprobar/rechazar reclamos, marcar como resuelto y eliminar cualquier publicación |

Un **reclamo** incluye un mensaje (para demostrar que el objeto es suyo) y un dato de contacto. Solo lo ven quien reclama, quien publicó y el personal.

## Tecnologías

- HTML, CSS y JavaScript (módulos ES), sin frameworks ni paso de compilación
- [Supabase](https://supabase.com) (Postgres + Auth + Storage) con reglas de seguridad por fila (RLS)
- PWA: `manifest.webmanifest` + `sw.js`

## Estructura

```
objetos-perdidos/
├── index.html
├── css/styles.css
├── js/
│   ├── app.js          # lógica y vistas
│   └── config.js       # URL y anon key de Supabase
├── icons/icon.svg
├── manifest.webmanifest
├── sw.js               # service worker
├── supabase/schema.sql          # tablas, reglas de seguridad y bucket de fotos
└── supabase/restrict-domain.sql # restringe el registro a @fi.uba.ar
```

## Puesta en marcha

### 1. Crear el proyecto en Supabase

1. Creá una cuenta y un proyecto en [supabase.com](https://supabase.com) (el plan gratuito alcanza para probar).
2. Andá a **SQL Editor → New query**, pegá el contenido de [`supabase/schema.sql`](supabase/schema.sql) y ejecutalo. Esto crea las tablas, las reglas de seguridad y el bucket `item-photos`.
3. En **Project Settings → API** copiá la **Project URL** y la **anon public key**.

### 1b. Restringir el registro a @fi.uba.ar

En el mismo SQL Editor, ejecutá [`supabase/restrict-domain.sql`](supabase/restrict-domain.sql). Crea una regla en la base de datos que rechaza cualquier registro con otro dominio. La app también lo valida en pantalla, pero la regla real es la de la base de datos.

### 2. Configurar la app

Editá `js/config.js`:

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'tu-anon-key';
```

> La *anon key* es pública por diseño: la seguridad la garantizan las reglas RLS de `schema.sql`. **Nunca** subas la `service_role key` al repositorio.

### 3. Correrla en tu computadora

Los módulos ES y el service worker necesitan un servidor (no se puede abrir `index.html` con doble clic):

```bash
cd objetos-perdidos
python3 -m http.server 8000
# o: npx serve
```

Abrí <http://localhost:8000>.

### 4. Crear cuentas de personal

Todos los usuarios se registran como `student`. Para dar rol de personal, ejecutá en el SQL Editor (reemplazá el mail):

```sql
update public.profiles
set role = 'staff'
where id = (select id from auth.users where email = 'persona@facultad.edu.ar');
```

Nadie puede cambiar su propio rol desde la app.

> En **Authentication → Providers → Email** podés activar o desactivar la confirmación por mail. Para producción conviene dejarla activada.

## Publicarla en internet

Es un sitio estático: sirve cualquier hosting gratuito. Las PWA requieren **HTTPS** (todos estos lo incluyen).

- **GitHub Pages**: *Settings → Pages → Deploy from a branch → `main` / root*.
- **Netlify** o **Vercel**: importá el repositorio, sin comando de build y con la raíz como carpeta de publicación.

Después, en Supabase (**Authentication → URL Configuration**) agregá la URL pública como *Site URL* para que los enlaces de confirmación funcionen.

Para instalarla en el celular: abrí la URL en Chrome/Safari → *Agregar a la pantalla de inicio* / *Instalar app*.

## Subir el código a GitHub

```bash
cd objetos-perdidos
git init
git add .
git commit -m "Primera versión: listado, reclamos y publicaciones"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/objetos-perdidos.git
git push -u origin main
```

## Hoja de ruta

- [x] Restringir el registro a mails institucionales (@fi.uba.ar)
- [ ] Notificaciones por mail cuando se aprueba un reclamo
- [ ] Panel del personal con estadísticas y filtros
- [ ] Vencimiento automático de publicaciones antiguas
- [ ] Empaquetar como app nativa (Capacitor) si hace falta publicarla en las tiendas

## Contribuir

Los issues y pull requests son bienvenidos. Para cambios grandes, abrí primero un issue para conversarlo.

## Licencia

Elegí una licencia (por ejemplo MIT) y agregá el archivo `LICENSE` antes de abrir el repositorio al público.
