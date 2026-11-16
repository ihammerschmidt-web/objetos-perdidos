import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './js/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '1mb' }));

let aiClient = null;
function getAI() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Falta configurar GEMINI_API_KEY en el servidor.');
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function fetchCatalogSnapshot() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/items?select=id,type,title,description,location,campus,event_date,time_from,pickup_point,status&order=created_at.desc&limit=50`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = rawMessages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
      .slice(-12);

    if (messages.length === 0) {
      return res.status(400).json({ error: 'Escribí un mensaje para iniciar la consulta.' });
    }

    const items = await fetchCatalogSnapshot();
    const catalogLines = items.length
      ? items
          .map((it) => {
            const parts = [
              `id=${it.id}`,
              `tipo=${it.type === 'found' ? 'Encontrado' : 'Perdido'}`,
              `estado=${it.status === 'returned' ? 'Resuelto' : 'Abierto'}`,
              `titulo="${it.title}"`,
              it.campus ? `sede="${it.campus}"` : null,
              `ubicacion="${it.location}"`,
              `fecha=${it.event_date}`,
              it.time_from ? `horario=${String(it.time_from).slice(0, 5)}` : null,
              it.pickup_point ? `retiro="${it.pickup_point}"` : null,
              it.description ? `desc="${it.description.slice(0, 140)}"` : null,
            ].filter(Boolean);
            return `- ${parts.join(' | ')}`;
          })
          .join('\n')
      : 'No hay objetos cargados actualmente en el catálogo.';

    const systemInstruction = `Sos el asistente virtual de fiubaLost, la plataforma de objetos perdidos y encontrados de la Facultad de Ingeniería de la Universidad de Buenos Aires (FIUBA).
Respondé siempre en español rioplatense (vos), de manera cordial, clara y concisa (máximo 130 palabras salvo que te pidan detalle).

Datos reales de la plataforma fiubaLost:
- Sedes de FIUBA: Paseo Colón (Av. Paseo Colón 850), Las Heras (Av. Gral. Las Heras 2214) y Ciudad Universitaria (Pabellón de Industrias, Int. Güiraldes 2160).
- Consulta pública: cualquiera puede ver y buscar objetos en #/ sin cuenta.
- Cuenta institucional: para publicar objetos o enviar reclamos hace falta registrarse/ingresar en #/login usando un correo @fi.uba.ar.
- Publicar: una vez logueado, se publica en #/new indicando tipo, sede, objeto, aula/sector, fecha, horario aproximado, descripción y foto opcional (máx. 5 MB).
- Reclamar: al abrir una publicación (#/item/<id>), se puede enviar un mensaje verificable (por ejemplo marca, contenido o un detalle único) y un dato de contacto. Solo lo ven quien reclama, quien publicó y el personal autorizado.
- Ver sedes: #/sedes. Ver mis publicaciones y reclamos: #/mine.
- Importante: NO inventes oficinas, horarios de atención ni digas "consultá en Bedelía/Intendencia" porque el usuario pidió explícitamente no mostrar eso. Limitáte a orientar sobre el uso de fiubaLost y los objetos publicados.

Catálogo actual en vivo de fiubaLost (útil para responder si alguien busca algo):
${catalogLines}

Reglas de respuesta:
- Si el usuario busca un objeto, revisá el catálogo actual y mencioná coincidencias reales incluyendo su enlace exacto con formato Markdown: [Nombre del objeto](#/item/ID).
- Si necesitás derivar a una sección de la app, usá enlaces Markdown con rutas hash: [Publicar objeto](#/new), [Ingresar](#/login), [Ver sedes](#/sedes), [Mis cosas](#/mine) o [Listado principal](#/).
- Nunca inventes publicaciones que no estén en el catálogo actual.`;

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text.trim() }],
    }));

    const ai = getAI();
    const candidateModels = [
      process.env.GEMINI_MODEL,
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-flash-latest',
    ].filter(Boolean);

    let reply = '';
    let lastError = null;

    for (const model of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
          },
        });
        reply = (response.text || '').trim();
        if (reply) break;
      } catch (err) {
        lastError = err;
        console.warn(`[fiubaLost] Falló modelo ${model} (${err?.status || err?.message}), probando siguiente...`);
      }
    }

    if (!reply) {
      throw lastError || new Error('No se pudo generar respuesta del asistente.');
    }

    res.json({ reply });
  } catch (err) {
    console.error('[fiubaLost chat error]', err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    const message =
      status === 403 || status === 400
        ? 'No se pudo autenticar el servicio de asistente. Revisá la configuración de API key en Settings > Secrets.'
        : 'Hubo un problema al consultar al asistente. Intentá de nuevo en unos segundos.';
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  }
});

app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/icons', express.static(path.join(__dirname, 'icons')));
app.use('/src/assets/images', express.static(path.join(__dirname, 'src', 'assets', 'images')));

app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'manifest.webmanifest'));
});

app.get('/sw.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`fiubaLost running at http://${HOST}:${PORT}`);
});
