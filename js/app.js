import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Solo se puede crear cuenta con mail de este dominio.
// (La regla real está en la base de datos: supabase/restrict-domain.sql)
const ALLOWED_EMAIL_DOMAIN = 'fi.uba.ar';
const isAllowedEmail = (email) => email.trim().toLowerCase().endsWith('@' + ALLOWED_EMAIL_DOMAIN);

const CAMPUSES = ['Paseo Colón', 'Las Heras', 'Ciudad Universitaria'];

const IMG_PASEO_COLON = 'src/assets/images/real_paseo_colon.jpg';
const IMG_LAS_HERAS = 'src/assets/images/real_las_heras.jpg';
const IMG_CIUDAD_UNIV = 'src/assets/images/real_ciudad_univ.jpg';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');

const state = {
  user: null,
  profile: null,
  tab: 'found', // 'found' | 'lost' | 'returned'
  campus: 'all',
  q: '',
  counts: { found: 0, lost: 0, returned: 0 },
};

const TYPE_LABEL = { found: 'Encontrado', lost: 'Perdido' };
const STATUS_LABEL = { open: 'Abierto', returned: 'Resuelto' };
const CLAIM_LABEL = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };

// ---------- utilidades ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isStaff = () => state.profile?.role === 'staff';

const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};

const fmtTimeRange = (from, to) => {
  const clean = (t) => (t ? String(t).slice(0, 5) : '');
  const f = clean(from);
  const t = clean(to);
  if (f && t) return `${f} a ${t}`;
  if (f) return `aprox. ${f}`;
  return '';
};

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function friendlyError(err) {
  const m = err?.message || String(err);
  if (/row-level security/i.test(m)) return 'No tenés permiso para hacer esto.';
  if (/duplicate key/i.test(m)) return 'Ya enviaste un reclamo para este objeto.';
  if (/Invalid login/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Confirmá tu email antes de ingresar (revisá tu bandeja).';
  if (/already registered/i.test(m)) return 'Ese email ya tiene una cuenta.';
  if (/Database error saving new user/i.test(m) || /fi\.uba\.ar/i.test(m))
    return `Solo se puede registrar con un mail @${ALLOWED_EMAIL_DOMAIN}.`;
  return m;
}

function configured() {
  return !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-ANON-KEY');
}

const go = (hash) => (location.hash = hash);

function fallbackMarkup(label = 'Sin fotografía adjunta') {
  return `
    <div class="media-fallback">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 9.5L12 4L21 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6.5 9.5V18.5M12 9.5V18.5M17.5 9.5V18.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M3.5 18.5H20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>${esc(label)}</span>
    </div>`;
}

function wireFallbackImages(root = app) {
  root.querySelectorAll('img[data-fallback]').forEach((img) => {
    img.addEventListener('error', () => {
      const parent = img.parentElement;
      if (parent) parent.innerHTML = fallbackMarkup(img.dataset.fallback || 'Imagen no disponible');
    });
  });
}

// ---------- sesión ----------
async function loadProfile() {
  if (!state.user) {
    state.profile = null;
    return;
  }
  const { data } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  state.profile = data;
}

function renderNav() {
  const nav = $('#nav');
  const action = $('#navAction');
  const current = location.hash || '#/';

  const link = (href, text) => {
    const active = href === '#/' ? current === '#/' || current === '' : current.startsWith(href);
    return `<a href="${href}" class="nav-link ${active ? 'active' : ''}">${text}</a>`;
  };

  let navHtml = link('#/', 'Listado') + link('#/sedes', 'Sedes');
  if (state.user) {
    navHtml += link('#/mine', 'Mis cosas');
    navHtml += `<button id="logout" class="nav-link" type="button">Salir</button>`;
  }
  nav.innerHTML = navHtml;

  action.innerHTML = state.user
    ? `<a class="btn compact" href="#/new">+ Publicar</a>`
    : `<a class="btn compact" href="#/login">Ingresar</a>`;

  $('#logout')?.addEventListener('click', async () => {
    await sb.auth.signOut();
    toast('Sesión cerrada');
    go('#/');
  });
}

// ---------- router ----------
async function route() {
  renderNav();
  if (!configured()) {
    app.innerHTML = `
      <div class="panel">
        <h1>Falta configurar Supabase</h1>
        <p>Abrí <code>js/config.js</code> y pegá la URL y la anon key de tu proyecto.
        Los pasos están en el README.</p>
      </div>`;
    return;
  }
  const [, path, id] = (location.hash || '#/').split('/');
  try {
    if (path === 'item' && id) return await viewItem(id);
    if (path === 'new') return viewNew();
    if (path === 'mine') return await viewMine();
    if (path === 'login') return viewLogin();
    if (path === 'sedes') return viewSedes();
    return await viewList();
  } catch (err) {
    app.innerHTML = `<div class="panel"><h1>No pudimos cargar esta vista</h1><p class="error-msg">${esc(friendlyError(err))}</p></div>`;
  }
}

// ---------- vistas ----------
function itemCard(it) {
  const media = it.photo_url
    ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(it.photo_url)}" alt="Foto de ${esc(it.title)}" data-fallback="${esc(it.title)}">`
    : fallbackMarkup('Sin fotografía');

  const stateClass = it.status === 'returned' ? 'returned' : it.type;
  const stateText = it.status === 'returned' ? 'Resuelto' : TYPE_LABEL[it.type];
  const timeTxt = fmtTimeRange(it.time_from, it.time_to);

  return `
    <a class="card" href="#/item/${esc(it.id)}">
      <div class="card-media">${media}</div>
      <div class="card-body">
        <div class="meta-line">
          <span class="state-label ${stateClass}">${stateText}</span>
          ${it.campus ? `<span aria-hidden="true">·</span><span>${esc(it.campus)}</span>` : ''}
          <span aria-hidden="true">·</span>
          <span class="mono">${fmtDate(it.event_date)}</span>
        </div>
        <h3 class="card-title">${esc(it.title)}</h3>
        <div class="card-location">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke="currentColor" stroke-width="1.7"/>
            <circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.7"/>
          </svg>
          <span>${esc(it.location)}${timeTxt ? ` · ${esc(timeTxt)}` : ''}</span>
        </div>
      </div>
    </a>`;
}

async function fetchCounts() {
  const [foundRes, lostRes, retRes] = await Promise.all([
    sb.from('items').select('*', { count: 'exact', head: true }).eq('type', 'found').eq('status', 'open'),
    sb.from('items').select('*', { count: 'exact', head: true }).eq('type', 'lost').eq('status', 'open'),
    sb.from('items').select('*', { count: 'exact', head: true }).eq('status', 'returned'),
  ]);
  state.counts = {
    found: foundRes.count ?? 0,
    lost: lostRes.count ?? 0,
    returned: retRes.count ?? 0,
  };
}

async function viewList() {
  const ctaHref = state.user ? '#/new' : '#/login';
  const ctaText = state.user ? 'Publicar objeto' : 'Ingresar con @fi.uba.ar';

  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <div>
          <div class="hero-kicker">Facultad de Ingeniería · Universidad de Buenos Aires</div>
          <h1>Objetos perdidos y encontrados en FIUBA</h1>
          <p class="hero-lead">
            Consultá los objetos encontrados o reportá lo que perdiste en las sedes Paseo Colón, Las Heras y Ciudad Universitaria.
          </p>
        </div>
        <div class="hero-actions">
          <a class="btn" href="${ctaHref}">${ctaText}</a>
          <a class="btn secondary" href="#/sedes">Ver sedes de FIUBA</a>
        </div>
      </div>

      <div class="hero-media">
        <img referrerpolicy="no-referrer" src="${IMG_PASEO_COLON}" alt="Fachada real de la Facultad de Ingeniería UBA en Avenida Paseo Colón 850" data-fallback="Sede Paseo Colón · Av. Paseo Colón 850">
        <div class="hero-scrim">
          <div class="hero-caption-title">Sede Paseo Colón</div>
          <div class="hero-caption-sub">Av. Paseo Colón 850 · San Telmo, Buenos Aires</div>
        </div>
      </div>
    </section>

    <section class="utility-strip" aria-label="Resumen del catálogo">
      <div class="utility-cell">
        <span class="utility-label">Encontrados abiertos</span>
        <span class="utility-value mono" id="statFound">—</span>
        <span class="utility-sub">En resguardo o publicados</span>
      </div>
      <div class="utility-cell">
        <span class="utility-label">Perdidos abiertos</span>
        <span class="utility-value mono" id="statLost">—</span>
        <span class="utility-sub">Reportados por alumnos</span>
      </div>
      <div class="utility-cell">
        <span class="utility-label">Objetos devueltos</span>
        <span class="utility-value mono" id="statReturned">—</span>
        <span class="utility-sub">Publicaciones resueltas</span>
      </div>
      <div class="utility-cell">
        <span class="utility-label">Acceso a publicaciones</span>
        <span class="utility-value">@fi.uba.ar</span>
        <span class="utility-sub">Consulta pública sin cuenta</span>
      </div>
    </section>

    <section class="toolbar" aria-label="Filtros y búsqueda">
      <div class="toolbar-top">
        <div class="segmented" role="tablist" aria-label="Estado de publicación">
          <button class="seg-btn ${state.tab === 'found' ? 'active' : ''}" data-tab="found" role="tab" aria-selected="${state.tab === 'found'}">
            Encontrados <span class="seg-count" id="cntFound"></span>
          </button>
          <button class="seg-btn ${state.tab === 'lost' ? 'active' : ''}" data-tab="lost" role="tab" aria-selected="${state.tab === 'lost'}">
            Perdidos <span class="seg-count" id="cntLost"></span>
          </button>
          <button class="seg-btn ${state.tab === 'returned' ? 'active' : ''}" data-tab="returned" role="tab" aria-selected="${state.tab === 'returned'}">
            Resueltos <span class="seg-count" id="cntReturned"></span>
          </button>
        </div>

        <div class="campus-filters" role="group" aria-label="Filtrar por sede">
          <button class="campus-btn ${state.campus === 'all' ? 'active' : ''}" data-campus="all" type="button">Todas las sedes</button>
          ${CAMPUSES.map(
            (c) => `<button class="campus-btn ${state.campus === c ? 'active' : ''}" data-campus="${esc(c)}" type="button">${esc(c)}</button>`
          ).join('')}
        </div>
      </div>

      <form class="search-bar" id="searchForm">
        <div class="search-input-wrap">
          <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
            <path d="M20 20L16.2 16.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <input type="search" id="q" aria-label="Buscar objetos" placeholder="Buscar por objeto, aula o detalle (ej: yerbera, aula 107, calculadora)…" value="${esc(state.q)}">
        </div>
        <button class="btn" type="submit">Buscar</button>
        ${state.q || state.campus !== 'all' ? `<button class="btn secondary" type="button" id="clearFilters">Limpiar</button>` : ''}
      </form>
    </section>

    <div id="results"><p class="muted">Cargando publicaciones…</p></div>`;

  wireFallbackImages();

  app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      viewList();
    })
  );

  app.querySelectorAll('[data-campus]').forEach((b) =>
    b.addEventListener('click', () => {
      state.campus = b.dataset.campus;
      viewList();
    })
  );

  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = $('#q').value.trim();
    viewList();
  });

  $('#clearFilters')?.addEventListener('click', () => {
    state.q = '';
    state.campus = 'all';
    viewList();
  });

  let query = sb
    .from('items')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);

  if (state.tab === 'returned') {
    query = query.eq('status', 'returned');
  } else {
    query = query.eq('type', state.tab).eq('status', 'open');
  }

  if (state.campus !== 'all') {
    query = query.eq('campus', state.campus);
  }

  const term = state.q.replace(/[,()%*_\\]/g, ' ').trim();
  if (term) {
    query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%,location.ilike.%${term}%`);
  }

  const [{ data, error }] = await Promise.all([query, fetchCounts().catch(() => {})]);
  if (error) throw error;

  if ($('#statFound')) $('#statFound').textContent = state.counts.found;
  if ($('#statLost')) $('#statLost').textContent = state.counts.lost;
  if ($('#statReturned')) $('#statReturned').textContent = state.counts.returned;
  if ($('#cntFound')) $('#cntFound').textContent = state.counts.found;
  if ($('#cntLost')) $('#cntLost').textContent = state.counts.lost;
  if ($('#cntReturned')) $('#cntReturned').textContent = state.counts.returned;

  const labelMap = {
    found: 'Objetos encontrados',
    lost: 'Objetos perdidos',
    returned: 'Publicaciones resueltas',
  };

  $('#results').innerHTML = data.length
    ? `<div class="results-header">
         <h2 class="results-title">${labelMap[state.tab]}${state.campus !== 'all' ? ` en ${esc(state.campus)}` : ''}</h2>
         <span class="muted small mono">${data.length} ${data.length === 1 ? 'resultado' : 'resultados'}</span>
       </div>
       <div class="grid">${data.map(itemCard).join('')}</div>`
    : `<div class="empty-state">
         <h3>No encontramos publicaciones con estos filtros</h3>
         <p>${
           term || state.campus !== 'all'
             ? 'Probá ampliando la búsqueda o seleccionando todas las sedes de FIUBA.'
             : 'Todavía no hay publicaciones activas en esta categoría.'
         }</p>
         <div class="row">
           ${term || state.campus !== 'all' ? `<button class="btn secondary" id="emptyClear" type="button">Ver todas las publicaciones</button>` : ''}
           <a class="btn" href="#/${state.user ? 'new' : 'login'}">
             ${state.user ? 'Publicar un objeto' : 'Ingresar para publicar'}
           </a>
         </div>
       </div>`;

  wireFallbackImages($('#results'));
  $('#emptyClear')?.addEventListener('click', () => {
    state.q = '';
    state.campus = 'all';
    viewList();
  });
}

async function viewItem(id) {
  const { data: it, error } = await sb.from('items').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!it) {
    app.innerHTML = `
      <div class="panel">
        <h1>Publicación no encontrada</h1>
        <p class="muted">Esa publicación no existe o fue eliminada por su autor o el personal.</p>
        <p><a class="btn secondary" href="#/">Volver al listado</a></p>
      </div>`;
    return;
  }

  const mine = state.user && it.created_by === state.user.id;
  const canManage = mine || isStaff();

  let claims = [];
  if (state.user) {
    const res = await sb.from('claims').select('*').eq('item_id', id).order('created_at');
    claims = res.data || [];
  }
  const myClaim = state.user ? claims.find((c) => c.claimant_id === state.user.id) : null;

  const claimLabel = it.type === 'found' ? 'Es mío, quiero reclamarlo' : 'Creo que lo encontré';
  const claimHelp =
    it.type === 'found'
      ? 'Describí un detalle verificable que solo el dueño conozca (marca, contenido, stickers, rayones o llave).'
      : 'Contá dónde y en qué horario lo encontraste para coordinar la devolución.';

  let claimBlock = '';
  if (it.status === 'returned') {
    claimBlock = `<p class="muted">Esta publicación ya fue marcada como resuelta y cerrada.</p>`;
  } else if (!state.user) {
    claimBlock = `
      <h2>${claimLabel}</h2>
      <p class="muted small" style="margin:8px 0 16px">Para enviar un reclamo o avisar que encontraste este objeto necesitás ingresar con tu cuenta institucional @${ALLOWED_EMAIL_DOMAIN}.</p>
      <a class="btn" href="#/login">Ingresar para reclamar</a>`;
  } else if (!mine && !myClaim) {
    claimBlock = `
      <form id="claimForm">
        <h2>${claimLabel}</h2>
        <p class="muted small" style="margin-top:6px">${claimHelp}</p>
        <label for="cmsg">Mensaje verificable</label>
        <textarea id="cmsg" required minlength="5" maxlength="500" placeholder="Escribí los detalles que permitan confirmar que se trata del mismo objeto…"></textarea>
        <label for="ccontact">Dato de contacto (mail o teléfono)</label>
        <input id="ccontact" required minlength="3" maxlength="100" value="${esc(state.user.email)}">
        <p class="error-msg" id="cerr" hidden></p>
        <p style="margin-top:16px"><button class="btn" type="submit">Enviar mensaje</button></p>
      </form>`;
  } else if (myClaim) {
    claimBlock = `
      <h2>Tu reclamo</h2>
      <p style="margin-top:8px">Estado actual: <span class="state-label ${myClaim.status}">${CLAIM_LABEL[myClaim.status]}</span></p>
      <p class="muted small" style="margin-top:6px">Enviado el <span class="mono">${fmtDate(myClaim.created_at)}</span> · Contacto informado: ${esc(myClaim.contact)}</p>`;
  } else {
    claimBlock = `
      <h2>Gestión de tu publicación</h2>
      <p class="muted small" style="margin-top:6px">Cuando alguien envíe un reclamo sobre este objeto aparecerá debajo para que puedas aprobarlo o rechazarlo.</p>`;
  }

  const claimsBlock =
    canManage && claims.length
      ? `<div class="panel">
           <h2>Reclamos recibidos (<span class="mono">${claims.length}</span>)</h2>
           <div style="margin-top:16px">
             ${claims
               .map(
                 (c) => `
               <div class="claim-item">
                 <div class="row space">
                   <span class="state-label ${c.status}">${CLAIM_LABEL[c.status]}</span>
                   <span class="muted small mono">${fmtDate(c.created_at)}</span>
                 </div>
                 <p class="claim-msg">${esc(c.message)}</p>
                 <p class="small"><strong>Contacto:</strong> ${esc(c.contact)}</p>
                 ${
                   c.status === 'pending'
                     ? `<div class="row" style="margin-top:10px">
                          <button class="btn compact ok" data-claim="${esc(c.id)}" data-set="approved" type="button">Aprobar</button>
                          <button class="btn compact danger-outline" data-claim="${esc(c.id)}" data-set="rejected" type="button">Rechazar</button>
                        </div>`
                     : ''
                 }
               </div>`
               )
               .join('')}
           </div>
         </div>`
      : '';

  const ownerActions = canManage
    ? `<div class="owner-actions">
         ${it.status === 'open' ? `<button class="btn compact ok" id="resolve" type="button">Marcar como resuelto</button>` : ''}
         <button class="btn compact danger-outline" id="askRemove" type="button">Eliminar publicación</button>
         <div class="confirm-inline" id="confirmBox" hidden>
           <span>¿Eliminar definitivamente?</span>
           <button class="btn compact danger" id="confirmRemove" type="button">Sí, eliminar</button>
           <button class="btn compact secondary" id="cancelRemove" type="button">Cancelar</button>
         </div>
       </div>`
    : '';

  const timeTxt = fmtTimeRange(it.time_from, it.time_to);
  const viewerMedia = it.photo_url
    ? `<img referrerpolicy="no-referrer" src="${esc(it.photo_url)}" alt="Foto de ${esc(it.title)}" data-fallback="${esc(it.title)}">`
    : fallbackMarkup('Publicación sin fotografía');

  app.innerHTML = `
    <a class="back-link" href="#/">← Volver al listado</a>

    <div class="detail-grid">
      <div class="detail-viewer">
        <div class="detail-frame">${viewerMedia}</div>
        <div class="detail-caption">
          <span>Registro FIUBA</span>
          <span class="mono">Publicado ${fmtDate(it.created_at || it.event_date)}</span>
        </div>
      </div>

      <div class="dossier-panel">
        <div class="meta-line">
          <span class="state-label ${esc(it.type)}">${TYPE_LABEL[it.type]}</span>
          <span aria-hidden="true">·</span>
          <span class="state-label ${it.status === 'returned' ? 'returned' : ''}">${STATUS_LABEL[it.status]}</span>
        </div>
        <h1>${esc(it.title)}</h1>

        <dl class="dossier-list">
          ${it.campus ? `<div class="dossier-row"><dt>Sede</dt><dd>${esc(it.campus)}</dd></div>` : ''}
          <div class="dossier-row">
            <dt>${it.type === 'found' ? 'Dónde se encontró' : 'Dónde se perdió'}</dt>
            <dd>${esc(it.location)}</dd>
          </div>
          <div class="dossier-row">
            <dt>Fecha</dt>
            <dd class="mono">${fmtDate(it.event_date)}</dd>
          </div>
          ${timeTxt ? `<div class="dossier-row"><dt>Horario</dt><dd class="mono">${esc(timeTxt)}</dd></div>` : ''}
          ${it.pickup_point ? `<div class="dossier-row"><dt>Retirar en</dt><dd>${esc(it.pickup_point)}</dd></div>` : ''}
        </dl>

        ${it.description ? `<p class="dossier-desc">${esc(it.description)}</p>` : ''}
        ${ownerActions}
      </div>
    </div>

    <div class="claims-section">
      <div class="panel">${claimBlock}</div>
      ${claimsBlock}
    </div>`;

  wireFallbackImages();

  $('#claimForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const { error: err } = await sb.from('claims').insert({
      item_id: id,
      message: $('#cmsg').value.trim(),
      contact: $('#ccontact').value.trim(),
    });
    if (err) {
      const box = $('#cerr');
      box.textContent = friendlyError(err);
      box.hidden = false;
      btn.disabled = false;
      return;
    }
    toast('Reclamo enviado');
    viewItem(id);
  });

  app.querySelectorAll('[data-claim]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      const { error: err } = await sb.from('claims').update({ status: b.dataset.set }).eq('id', b.dataset.claim);
      if (err) toast(friendlyError(err));
      else toast('Reclamo actualizado');
      viewItem(id);
    })
  );

  $('#resolve')?.addEventListener('click', async () => {
    const { error: err } = await sb.from('items').update({ status: 'returned' }).eq('id', id);
    if (err) return toast(friendlyError(err));
    toast('Marcado como resuelto');
    viewItem(id);
  });

  $('#askRemove')?.addEventListener('click', () => {
    $('#askRemove').hidden = true;
    $('#confirmBox').hidden = false;
  });

  $('#cancelRemove')?.addEventListener('click', () => {
    $('#confirmBox').hidden = true;
    $('#askRemove').hidden = false;
  });

  $('#confirmRemove')?.addEventListener('click', async () => {
    const { error: err } = await sb.from('items').delete().eq('id', id);
    if (err) return toast(friendlyError(err));
    toast('Publicación eliminada');
    go('#/');
  });
}

function viewNew() {
  if (!state.user) return go('#/login');
  const staff = isStaff();
  const today = new Date().toISOString().slice(0, 10);

  app.innerHTML = `
    <a class="back-link" href="#/">← Volver al listado</a>
    <h1>Nueva publicación</h1>
    <p class="muted" style="margin:6px 0 22px">Completá los datos del objeto para que la comunidad de FIUBA pueda identificarlo.</p>

    <div class="split-layout">
      <form class="panel" id="newForm">
        <div class="field-grid">
          <div>
            <label for="type">Tipo de publicación</label>
            <select id="type">
              ${staff ? '<option value="found">Objeto encontrado (en resguardo)</option>' : ''}
              <option value="lost" ${staff ? '' : 'selected'}>Algo que perdí</option>
            </select>
          </div>
          <div>
            <label for="campus">Sede de FIUBA</label>
            <select id="campus">
              <option value="Paseo Colón">Paseo Colón (Av. Paseo Colón 850)</option>
              <option value="Las Heras">Las Heras (Av. Las Heras 2214)</option>
              <option value="Ciudad Universitaria">Ciudad Universitaria (Pab. Industrias)</option>
            </select>
          </div>
        </div>

        <label for="title">¿Qué objeto es?</label>
        <input id="title" required minlength="3" maxlength="100" placeholder="Ej: Calculadora científica Casio, campera azul, llaves">

        <label for="location" id="locLabel">¿En qué aula o sector lo perdiste?</label>
        <input id="location" required minlength="2" maxlength="150" placeholder="Ej: Aula 107, Biblioteca Central, Laboratorio de Electrónica, Bar">

        <div class="field-grid field-group">
          <div>
            <label for="date">Fecha aproximada</label>
            <input id="date" type="date" required value="${today}" max="${today}">
          </div>
          <div>
            <label for="timeFrom">Horario aproximado (opcional)</label>
            <input id="timeFrom" type="time">
          </div>
        </div>

        <div id="pickupWrap" hidden>
          <label for="pickup">Dónde retirarlo</label>
          <input id="pickup" maxlength="150" placeholder="Ej: Bedelía Planta Baja, de 9 a 19 hs">
        </div>

        <label for="desc">Descripción</label>
        <textarea id="desc" maxlength="1000" placeholder="Color, marca, estado o detalles útiles (si es un objeto encontrado, podés reservar algún detalle clave para validar al dueño)."></textarea>

        <label for="photo">Fotografía (opcional, máx. 5 MB)</label>
        <input id="photo" type="file" accept="image/*">
        <div class="preview-box" id="photoPreview" hidden></div>

        <div class="error-msg" id="nerr" hidden></div>
        <p style="margin-top:20px"><button class="btn" type="submit">Publicar en fiubaLost</button></p>
      </form>

      <aside class="aside-card">
        <img referrerpolicy="no-referrer" src="${IMG_PASEO_COLON}" alt="Fachada de la Facultad de Ingeniería UBA Sede Paseo Colón" data-fallback="Guía de publicación FIUBA">
        <div class="aside-card-body">
          <h3>Consejos para recuperar más rápido</h3>
          <ul class="guide-list">
            <li>
              <strong>Indicá el aula y el piso</strong>
              En Paseo Colón, aclarar si fue en el subsuelo, aulas del 1.° al 5.° piso, biblioteca o cantina acelera la búsqueda.
            </li>
            <li>
              <strong>Cuidá los detalles verificables</strong>
              Si encontraste un objeto, no describas absolutamente todo: guardá un detalle (fondo de pantalla, contenido o llavero) para comprobar la identidad de quien reclama.
            </li>
          </ul>
        </div>
      </aside>
    </div>`;

  wireFallbackImages();

  const typeSel = $('#type');
  const sync = () => {
    const found = typeSel.value === 'found';
    $('#locLabel').textContent = found ? '¿Dónde se encontró?' : '¿En qué aula o sector lo perdiste?';
    $('#pickupWrap').hidden = !found;
  };
  typeSel.addEventListener('change', sync);
  sync();

  $('#photo').addEventListener('change', () => {
    const file = $('#photo').files[0];
    const box = $('#photoPreview');
    if (!file) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const url = URL.createObjectURL(file);
    box.innerHTML = `<img src="${url}" alt="Vista previa de la foto">`;
    box.hidden = false;
  });

  $('#newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const box = $('#nerr');
    box.hidden = true;
    btn.disabled = true;
    try {
      let photo_url = null;
      const file = $('#photo').files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error('La foto supera los 5 MB.');
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${state.user.id}/${Date.now()}-${safe}`;
        const up = await sb.storage.from('item-photos').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        photo_url = sb.storage.from('item-photos').getPublicUrl(path).data.publicUrl;
      }

      const type = typeSel.value;
      const timeVal = $('#timeFrom').value;
      const payload = {
        type,
        campus: $('#campus').value,
        title: $('#title').value.trim(),
        location: $('#location').value.trim(),
        event_date: $('#date').value,
        time_from: timeVal ? `${timeVal}:00` : null,
        description: $('#desc').value.trim(),
        pickup_point: type === 'found' ? $('#pickup').value.trim() || null : null,
        photo_url,
      };

      const { data, error } = await sb.from('items').insert(payload).select('id').single();
      if (error) throw error;
      toast('Publicación creada');
      go(`#/item/${data.id}`);
    } catch (err) {
      box.textContent = friendlyError(err);
      box.hidden = false;
      btn.disabled = false;
    }
  });
}

async function viewMine() {
  if (!state.user) return go('#/login');
  const [items, claims] = await Promise.all([
    sb.from('items').select('*').eq('created_by', state.user.id).order('created_at', { ascending: false }),
    sb
      .from('claims')
      .select('*, items(id, title, type)')
      .eq('claimant_id', state.user.id)
      .order('created_at', { ascending: false }),
  ]);
  if (items.error) throw items.error;
  if (claims.error) throw claims.error;

  app.innerHTML = `
    <div class="profile-banner">
      <div>
        <h1>Mis cosas</h1>
        <p class="muted small" style="margin-top:4px">
          ${esc(state.profile?.full_name || state.user.email)}
          <span aria-hidden="true">·</span>
          <span>${esc(state.user.email)}</span>
          <span aria-hidden="true">·</span>
          <span>${isStaff() ? 'Personal de facultad' : 'Estudiante / Comunidad FIUBA'}</span>
        </p>
      </div>
      <a class="btn" href="#/new">+ Nueva publicación</a>
    </div>

    <section>
      <div class="results-header">
        <h2>Mis publicaciones</h2>
        <span class="muted small mono">${items.data.length}</span>
      </div>
      ${
        items.data.length
          ? `<div class="grid">${items.data.map(itemCard).join('')}</div>`
          : `<div class="empty-state">
               <h3>Todavía no publicaste ningún objeto</h3>
               <p>Si perdiste algo en la facultad o querés registrar un hallazgo, podés crear una publicación en menos de un minuto.</p>
               <a class="btn" href="#/new">Publicar algo</a>
             </div>`
      }
    </section>

    <section class="section-gap">
      <div class="results-header">
        <h2>Mis reclamos enviados</h2>
        <span class="muted small mono">${claims.data.length}</span>
      </div>
      ${
        claims.data.length
          ? `<div class="panel mine-list">
               ${claims.data
                 .map(
                   (c) => `
                 <div class="mine-row">
                   <div>
                     <a href="#/item/${esc(c.items?.id)}">${esc(c.items?.title || 'Publicación eliminada')}</a>
                     <div class="muted small mono" style="margin-top:2px">Enviado el ${fmtDate(c.created_at)}</div>
                   </div>
                   <span class="state-label ${c.status}">${CLAIM_LABEL[c.status]}</span>
                 </div>`
                 )
                 .join('')}
             </div>`
          : `<div class="panel"><p class="muted">No enviaste reclamos todavía.</p></div>`
      }
    </section>`;

  wireFallbackImages();
}

function viewSedes() {
  app.innerHTML = `
    <a class="back-link" href="#/">← Volver al listado</a>
    <h1>Sedes de FIUBA</h1>
    <p class="hero-lead" style="margin-top:10px">
      Información de referencia sobre las tres sedes de la Facultad de Ingeniería de la Universidad de Buenos Aires para ubicar con precisión dónde se perdió o encontró un objeto.
    </p>

    <div class="sedes-grid">
      <article class="sede-card">
        <div class="sede-card-media">
          <img referrerpolicy="no-referrer" src="${IMG_PASEO_COLON}" alt="Sede Paseo Colón de FIUBA" data-fallback="Sede Paseo Colón">
        </div>
        <div class="sede-card-body">
          <div class="sede-address">Av. Paseo Colón 850 · San Telmo</div>
          <h2>Sede Paseo Colón</h2>
          <p class="muted small">Edificio principal monumental con aulas del 1.° al 5.° piso, subsuelo, laboratorios y Biblioteca Central.</p>
          <div class="sede-facts">
            <div><strong>Zonas frecuentes:</strong> Aulas 100–500, mesas de estudio, biblioteca, fotocopiadora y cantina.</div>
          </div>
        </div>
      </article>

      <article class="sede-card">
        <div class="sede-card-media">
          <img referrerpolicy="no-referrer" src="${IMG_LAS_HERAS}" alt="Sede Las Heras de FIUBA" data-fallback="Sede Las Heras">
        </div>
        <div class="sede-card-body">
          <div class="sede-address">Av. Gral. Las Heras 2214 · Recoleta</div>
          <h2>Sede Las Heras</h2>
          <p class="muted small">Edificio histórico neogótico con galería de arcos, patio central y aulas de cursos iniciales y departamentos.</p>
          <div class="sede-facts">
            <div><strong>Zonas frecuentes:</strong> Aulas 101–300, bancos del patio central y salas de dibujo.</div>
          </div>
        </div>
      </article>

      <article class="sede-card">
        <div class="sede-card-media">
          <img referrerpolicy="no-referrer" src="${IMG_CIUDAD_UNIV}" alt="Pabellón de Industrias en Ciudad Universitaria" data-fallback="Ciudad Universitaria">
        </div>
        <div class="sede-card-body">
          <div class="sede-address">Int. Güiraldes 2160 · Pabellón de Industrias</div>
          <h2>Ciudad Universitaria</h2>
          <p class="muted small">Sede de los departamentos de Ingeniería Química, Alimentos e Industrias en el campus de Núñez.</p>
          <div class="sede-facts">
            <div><strong>Zonas frecuentes:</strong> Laboratorios de procesos, aulas de seminario y pasillos comunes.</div>
          </div>
        </div>
      </article>
    </div>

    <div class="panel section-gap">
      <h2>Cómo funciona fiubaLost</h2>
      <div class="sede-facts" style="border-top:0; padding-top:4px; margin-top:8px">
        <div><strong>1. Verificación institucional:</strong> Solo quienes tienen correo <code>@${ALLOWED_EMAIL_DOMAIN}</code> pueden publicar objetos perdidos o enviar reclamos, manteniendo la comunidad segura y acotada a FIUBA.</div>
        <div><strong>2. Reclamo con descripción privada:</strong> Cuando alguien reclama un objeto encontrado, su mensaje y dato de contacto solo son visibles para el autor de la publicación y el personal autorizado.</div>
        <div><strong>3. Cierre transparente:</strong> Una vez devuelto el objeto, la publicación se marca como resuelta y pasa al historial de devoluciones.</div>
      </div>
    </div>`;

  wireFallbackImages();
}

function viewLogin() {
  if (state.user) return go('#/');
  let signup = false;

  const draw = () => {
    app.innerHTML = `
      <a class="back-link" href="#/">← Volver al listado</a>
      <div class="split-layout">
        <form class="panel" id="authForm">
          <h1>${signup ? 'Crear cuenta institucional' : 'Ingresar a fiubaLost'}</h1>
          <p class="muted small" style="margin:6px 0 18px">
            Para publicar objetos o enviar reclamos necesitás una cuenta con tu correo <strong>@${ALLOWED_EMAIL_DOMAIN}</strong>.
          </p>

          ${
            signup
              ? `<label for="name">Nombre y apellido</label>
                 <input id="name" required maxlength="80" autocomplete="name" placeholder="Ej: Sofía Martínez">`
              : ''
          }

          <label for="email">Correo institucional</label>
          <input id="email" type="email" required autocomplete="email" placeholder="usuario@${ALLOWED_EMAIL_DOMAIN}">

          <label for="pass">Contraseña</label>
          <input id="pass" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="Mínimo 8 caracteres">

          <div class="error-msg" id="aerr" hidden></div>

          <div class="row" style="margin-top:20px">
            <button class="btn" type="submit">${signup ? 'Crear cuenta' : 'Ingresar'}</button>
            <button class="btn secondary" type="button" id="toggle">${signup ? 'Ya tengo cuenta' : 'Crear cuenta nueva'}</button>
          </div>
        </form>

        <aside class="aside-card">
          <img referrerpolicy="no-referrer" src="${IMG_LAS_HERAS}" alt="Galería neogótica de FIUBA Sede Las Heras" data-fallback="FIUBA Las Heras">
          <div class="aside-card-body">
            <h3>Comunidad verificada FIUBA</h3>
            <p class="muted small" style="margin-top:8px">
              El listado público puede consultarse sin iniciar sesión. La validación por dominio <strong>@${ALLOWED_EMAIL_DOMAIN}</strong> protege los datos de contacto y evita reclamos apócrifos.
            </p>
          </div>
        </aside>
      </div>`;

    wireFallbackImages();

    $('#toggle').addEventListener('click', () => {
      signup = !signup;
      draw();
    });

    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      const box = $('#aerr');
      box.hidden = true;
      btn.disabled = true;

      const email = $('#email').value.trim();
      const password = $('#pass').value;

      if (signup && !isAllowedEmail(email)) {
        box.textContent = `Para crear una cuenta necesitás un mail @${ALLOWED_EMAIL_DOMAIN}.`;
        box.hidden = false;
        btn.disabled = false;
        return;
      }

      const res = signup
        ? await sb.auth.signUp({ email, password, options: { data: { full_name: $('#name').value.trim() } } })
        : await sb.auth.signInWithPassword({ email, password });

      if (res.error) {
        box.textContent = friendlyError(res.error);
        box.hidden = false;
        btn.disabled = false;
        return;
      }

      if (signup && !res.data.session) {
        app.innerHTML = `
          <div class="panel">
            <h1>Revisá tu correo @${ALLOWED_EMAIL_DOMAIN}</h1>
            <p style="margin-top:8px">Te enviamos un enlace para confirmar tu cuenta. Una vez confirmado, ya podés ingresar y publicar.</p>
            <p style="margin-top:16px"><a class="btn secondary" href="#/">Volver al listado</a></p>
          </div>`;
        return;
      }

      toast('¡Bienvenido/a a fiubaLost!');
      go('#/');
    });
  };

  draw();
}

// ---------- chatbot ----------
function formatChatText(text) {
  let html = esc(text);
  // Markdown links to internal hash routes: [label](#/...)
  html = html.replace(/\[([^\]]+)\]\((#\/[a-zA-Z0-9_/-]*)\)/g, '<a href="$2" data-chat-link>$1</a>');
  // Bold **text** and inline `code`
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Paragraphs / line breaks
  const paragraphs = html.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    const isList = lines.every((l) => /^\s*[-*]\s+/.test(l));
    if (isList) {
      return `<ul>${lines.map((l) => `<li>${l.replace(/^\s*[-*]\s+/, '')}</li>`).join('')}</ul>`;
    }
    return `<p>${lines.join('<br>')}</p>`;
  });
  return paragraphs.join('');
}

function initChatbot() {
  const toggle = $('#chatToggle');
  const panel = $('#chatPanel');
  const closeBtn = $('#chatClose');
  const messagesEl = $('#chatMessages');
  const form = $('#chatForm');
  const input = $('#chatInput');
  const sendBtn = $('#chatSend');
  const suggestions = $('#chatSuggestions');
  if (!toggle || !panel) return;

  const history = [
    {
      role: 'assistant',
      text: '¡Hola! Soy el asistente de **fiubaLost**. Te puedo ayudar a buscar si alguien ya publicó tu objeto, guiarte para publicar o explicar cómo enviar un reclamo.',
    },
  ];
  let busy = false;

  const renderMessages = () => {
    messagesEl.innerHTML = history
      .map((m) => {
        if (m.role === 'error') {
          return `<div class="chat-msg error">${esc(m.text)}</div>`;
        }
        return `<div class="chat-msg ${m.role}">${m.role === 'assistant' ? formatChatText(m.text) : esc(m.text)}</div>`;
      })
      .join('');
    if (busy) {
      messagesEl.insertAdjacentHTML('beforeend', `<div class="chat-msg assistant muted">Pensando…</div>`);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      renderMessages();
      input.focus();
    }
  };

  const sendMessage = async (text) => {
    const clean = text.trim();
    if (!clean || busy) return;

    history.push({ role: 'user', text: clean });
    if (suggestions) suggestions.hidden = true;
    input.value = '';
    busy = true;
    sendBtn.disabled = true;
    renderMessages();

    try {
      const payloadMessages = history.filter((m) => m.role === 'user' || m.role === 'assistant');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payloadMessages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) {
        throw new Error(data.error || 'No pudimos obtener respuesta del asistente.');
      }
      history.push({ role: 'assistant', text: data.reply });
    } catch (err) {
      history.push({ role: 'error', text: err.message || 'Error al conectar con el asistente.' });
    } finally {
      busy = false;
      sendBtn.disabled = false;
      renderMessages();
    }
  };

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  closeBtn?.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  suggestions?.querySelectorAll('[data-prompt]').forEach((btn) =>
    btn.addEventListener('click', () => sendMessage(btn.dataset.prompt))
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });
}

// ---------- arranque ----------
async function init() {
  $('#brandName').textContent = APP_NAME;
  document.title = `${APP_NAME} — Objetos perdidos de FIUBA`;

  if (configured()) {
    const { data } = await sb.auth.getSession();
    state.user = data.session?.user ?? null;
    await loadProfile();
    sb.auth.onAuthStateChange(async (_event, session) => {
      const changed = (session?.user?.id ?? null) !== (state.user?.id ?? null);
      state.user = session?.user ?? null;
      if (changed) {
        await loadProfile();
        route();
      }
    });
  }

  initChatbot();
  window.addEventListener('hashchange', route);
  await route();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
