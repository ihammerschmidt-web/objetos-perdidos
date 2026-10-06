import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Solo se puede crear cuenta con mail de este dominio.
// (La regla real está en la base de datos: supabase/restrict-domain.sql)
const ALLOWED_EMAIL_DOMAIN = 'fi.uba.ar';
const isAllowedEmail = (email) => email.trim().toLowerCase().endsWith('@' + ALLOWED_EMAIL_DOMAIN);

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const state = { user: null, profile: null, tab: 'found', q: '' };

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
  const route = location.hash || '#/';
  const link = (href, text) =>
    `<a href="${href}" class="${route === href ? 'active' : ''}">${text}</a>`;
  let html = link('#/', 'Inicio');
  if (state.user) {
    html += link('#/new', '+ Publicar');
    html += link('#/mine', 'Mis cosas');
    html += `<button id="logout" type="button">Salir</button>`;
  } else {
    html += link('#/login', 'Ingresar');
  }
  nav.innerHTML = html;
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
    return await viewList();
  } catch (err) {
    app.innerHTML = `<div class="panel"><h1>Ups</h1><p class="error">${esc(friendlyError(err))}</p></div>`;
  }
}

// ---------- vistas ----------
function itemCard(it) {
  const thumb = it.photo_url
    ? `<img class="thumb" loading="lazy" src="${esc(it.photo_url)}" alt="Foto de ${esc(it.title)}">`
    : `<div class="thumb empty" aria-hidden="true">${it.type === 'found' ? '📦' : '🔎'}</div>`;
  return `
    <a class="card" href="#/item/${esc(it.id)}">
      ${thumb}
      <div class="body">
        <span class="badge ${esc(it.type)}">${TYPE_LABEL[it.type]}</span>
        ${it.status === 'returned' ? '<span class="badge returned">Resuelto</span>' : ''}
        <h3>${esc(it.title)}</h3>
        <div class="muted small">📍 ${esc(it.location)} · ${fmtDate(it.event_date)}</div>
      </div>
    </a>`;
}

async function viewList() {
  app.innerHTML = `
    <h1>Objetos de la facultad</h1>
    <div class="tabs" role="tablist">
      <button class="tab ${state.tab === 'found' ? 'active' : ''}" data-tab="found" role="tab">📦 Encontrados</button>
      <button class="tab ${state.tab === 'lost' ? 'active' : ''}" data-tab="lost" role="tab">🔎 Perdidos</button>
    </div>
    <form class="search" id="searchForm">
      <input type="search" id="q" placeholder="Buscar: mochila, llaves, aula 4…" value="${esc(state.q)}">
      <button class="btn" type="submit">Buscar</button>
    </form>
    <div id="results"><p class="muted">Buscando…</p></div>`;

  app.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      viewList();
    })
  );
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = $('#q').value.trim();
    viewList();
  });

  let query = sb
    .from('items')
    .select('*')
    .eq('type', state.tab)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(60);
  const term = state.q.replace(/[,()%*_\\]/g, ' ').trim();
  if (term) {
    query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%,location.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw error;

  $('#results').innerHTML = data.length
    ? `<div class="grid">${data.map(itemCard).join('')}</div>`
    : `<div class="empty-state">
         <p>No hay publicaciones${term ? ' que coincidan con tu búsqueda' : ' por ahora'}.</p>
         <p><a class="btn secondary" href="#/${state.user ? 'new' : 'login'}">${
           state.tab === 'lost' ? 'Publicar algo que perdí' : 'Ingresar para publicar'
         }</a></p>
       </div>`;
}

async function viewItem(id) {
  const { data: it, error } = await sb.from('items').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!it) {
    app.innerHTML = `<div class="panel"><p>Esa publicación no existe o fue eliminada.</p><a class="btn secondary" href="#/">Volver</a></div>`;
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
      ? 'Describí algo que solo el dueño sabría (color, marca, contenido, rayones).'
      : 'Contá dónde y cuándo lo encontraste.';

  let claimBlock = '';
  if (it.status === 'returned') {
    claimBlock = `<p class="muted">Esta publicación ya fue resuelta.</p>`;
  } else if (!state.user) {
    claimBlock = `<a class="btn" href="#/login">Ingresá para reclamar</a>`;
  } else if (!mine && !myClaim) {
    claimBlock = `
      <form id="claimForm">
        <h2>${claimLabel}</h2>
        <p class="muted small">${claimHelp}</p>
        <label for="cmsg">Mensaje</label>
        <textarea id="cmsg" required minlength="5" maxlength="500"></textarea>
        <label for="ccontact">Cómo contactarte (mail o teléfono)</label>
        <input id="ccontact" required minlength="3" maxlength="100" value="${esc(state.user.email)}">
        <p class="error" id="cerr" hidden></p>
        <p><button class="btn" type="submit">Enviar</button></p>
      </form>`;
  } else if (myClaim) {
    claimBlock = `<p>Tu reclamo: <span class="badge ${myClaim.status}">${CLAIM_LABEL[myClaim.status]}</span></p>`;
  }

  const claimsBlock =
    canManage && claims.length
      ? `<h2>Reclamos recibidos (${claims.length})</h2>
         <div class="panel">${claims
           .map(
             (c) => `
           <div class="claim">
             <div class="row space">
               <span class="badge ${c.status}">${CLAIM_LABEL[c.status]}</span>
               <span class="muted small">${fmtDate(c.created_at)}</span>
             </div>
             <p>${esc(c.message)}</p>
             <p class="small"><strong>Contacto:</strong> ${esc(c.contact)}</p>
             ${
               c.status === 'pending'
                 ? `<div class="row">
                      <button class="btn small ok" data-claim="${esc(c.id)}" data-set="approved">Aprobar</button>
                      <button class="btn small danger" data-claim="${esc(c.id)}" data-set="rejected">Rechazar</button>
                    </div>`
                 : ''
             }
           </div>`
           )
           .join('')}</div>`
      : '';

  const ownerActions = canManage
    ? `<div class="row" style="margin-top:14px">
         ${it.status === 'open' ? `<button class="btn ok small" id="resolve">Marcar como resuelto</button>` : ''}
         <button class="btn danger small" id="remove">Eliminar publicación</button>
       </div>`
    : '';

  app.innerHTML = `
    <p><a href="#/">← Volver</a></p>
    ${it.photo_url ? `<img class="detail-photo" src="${esc(it.photo_url)}" alt="Foto de ${esc(it.title)}">` : ''}
    <div class="panel" style="margin-top:12px">
      <div class="row">
        <span class="badge ${esc(it.type)}">${TYPE_LABEL[it.type]}</span>
        <span class="badge ${esc(it.status)}">${STATUS_LABEL[it.status]}</span>
      </div>
      <h1>${esc(it.title)}</h1>
      <div class="meta">
        <div>📍 <strong>${it.type === 'found' ? 'Dónde se encontró' : 'Dónde se perdió'}:</strong> ${esc(it.location)}</div>
        <div>📅 <strong>Fecha:</strong> ${fmtDate(it.event_date)}</div>
        ${it.pickup_point ? `<div>🏢 <strong>Retirar en:</strong> ${esc(it.pickup_point)}</div>` : ''}
      </div>
      ${it.description ? `<p style="white-space:pre-wrap">${esc(it.description)}</p>` : ''}
      ${ownerActions}
    </div>
    <div class="panel">${claimBlock}</div>
    ${claimsBlock}`;

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

  $('#remove')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta publicación? No se puede deshacer.')) return;
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
    <h1>Nueva publicación</h1>
    <form class="panel" id="newForm">
      <label for="type">¿Qué querés publicar?</label>
      <select id="type">
        ${staff ? '<option value="found">Objeto encontrado (lo tiene el personal)</option>' : ''}
        <option value="lost" ${staff ? '' : 'selected'}>Algo que perdí</option>
      </select>

      <label for="title">Qué es</label>
      <input id="title" required minlength="3" maxlength="100" placeholder="Ej: Campera azul, llaves con llavero rojo">

      <label for="location" id="locLabel">Dónde lo perdiste</label>
      <input id="location" required minlength="2" maxlength="150" placeholder="Ej: Aula 4, biblioteca, cantina">

      <label for="date">Fecha aproximada</label>
      <input id="date" type="date" required value="${today}" max="${today}">

      <div id="pickupWrap" hidden>
        <label for="pickup">Dónde retirarlo</label>
        <input id="pickup" maxlength="150" placeholder="Ej: Bedelía, planta baja, de 9 a 18">
      </div>

      <label for="desc">Descripción</label>
      <textarea id="desc" maxlength="1000" placeholder="Marca, color, detalles que ayuden a reconocerlo"></textarea>

      <label for="photo">Foto (opcional, máx. 5 MB)</label>
      <input id="photo" type="file" accept="image/*">

      <p class="error" id="nerr" hidden></p>
      <p><button class="btn" type="submit">Publicar</button></p>
    </form>`;

  const typeSel = $('#type');
  const sync = () => {
    const found = typeSel.value === 'found';
    $('#locLabel').textContent = found ? 'Dónde se encontró' : 'Dónde lo perdiste';
    $('#pickupWrap').hidden = !found;
  };
  typeSel.addEventListener('change', sync);
  sync();

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
      const { data, error } = await sb
        .from('items')
        .insert({
          type,
          title: $('#title').value.trim(),
          location: $('#location').value.trim(),
          event_date: $('#date').value,
          description: $('#desc').value.trim(),
          pickup_point: type === 'found' ? $('#pickup').value.trim() || null : null,
          photo_url,
        })
        .select('id')
        .single();
      if (error) throw error;
      toast('Publicado');
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
    <h1>Mis cosas</h1>
    <p class="muted small">${esc(state.profile?.full_name || state.user.email)}${isStaff() ? ' · Personal' : ''}</p>
    <h2>Mis publicaciones</h2>
    ${
      items.data.length
        ? `<div class="grid">${items.data.map(itemCard).join('')}</div>`
        : `<p class="muted">Todavía no publicaste nada. <a href="#/new">Publicar algo</a></p>`
    }
    <h2>Mis reclamos</h2>
    ${
      claims.data.length
        ? `<div class="panel">${claims.data
            .map(
              (c) => `
            <div class="claim row space">
              <a href="#/item/${esc(c.items?.id)}">${esc(c.items?.title || 'Publicación eliminada')}</a>
              <span class="badge ${c.status}">${CLAIM_LABEL[c.status]}</span>
            </div>`
            )
            .join('')}</div>`
        : `<p class="muted">No enviaste reclamos.</p>`
    }`;
}

function viewLogin() {
  if (state.user) return go('#/');
  let signup = false;

  const draw = () => {
    app.innerHTML = `
      <h1>${signup ? 'Crear cuenta' : 'Ingresar'}</h1>
      <form class="panel" id="authForm">
        ${
          signup
            ? `<label for="name">Nombre y apellido</label>
               <input id="name" required maxlength="80" autocomplete="name">`
            : ''
        }
        <label for="email">Email</label>
        <input id="email" type="email" required autocomplete="email">
        <label for="pass">Contraseña</label>
        <input id="pass" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}">
        <p class="error" id="aerr" hidden></p>
        <p class="row">
          <button class="btn" type="submit">${signup ? 'Crear cuenta' : 'Ingresar'}</button>
          <button class="btn secondary" type="button" id="toggle">${
            signup ? 'Ya tengo cuenta' : 'Crear cuenta nueva'
          }</button>
        </p>
      </form>
      <p class="muted small">Para publicar y reclamar necesitás una cuenta con tu mail @${ALLOWED_EMAIL_DOMAIN}. Ver el listado es libre.</p>`;

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
        app.innerHTML = `<div class="panel"><h1>Revisá tu email</h1>
          <p>Te mandamos un enlace para confirmar tu cuenta. Después podés ingresar.</p></div>`;
        return;
      }
      toast('¡Bienvenido/a!');
      go('#/');
    });
  };
  draw();
}

// ---------- arranque ----------
async function init() {
  $('#brandName').textContent = APP_NAME;
  document.title = APP_NAME;

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

  window.addEventListener('hashchange', route);
  await route();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
